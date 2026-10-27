"""Serving content packs (mods) to the page: the list of packs found and their files. The same two routes the development server of the
client offers (`client/vite/modsServer.ts`), so the page works the same with either.

A pack is a folder with `manifest.json` and an `assets/` folder (docs/modding.md). Mods are data: only json, png, webp, svg, ogg and wav
files are ever served, symbolic links are never followed, and a path may not leave its pack folder. The page validates a pack itself when it
loads it (size limits, file signatures, the schema, unsafe SVG), so the list here only reports what can be read cheaply: whether the
manifest parses and is a mod. Packs are looked for in `mods/examples` and `mods/local` of the repository (when it is there) and in the
per-user folder, which is where the packaged app finds them.
"""
import json
import os
import re
import sys
from pathlib import Path

from server.paths import resource_root

TYPES = {"json": "application/json", "png": "image/png", "webp": "image/webp", "svg": "image/svg+xml", "ogg": "audio/ogg", "wav": "audio/wav"}
MANIFEST_BYTES = 256 * 1024
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def user_mods_dir() -> Path:
    """The per-user mods folder (override with UNDERCUT_MODS): the same places as `packRoots` in `client/src/packs/readDir.ts`."""
    if os.environ.get("UNDERCUT_MODS"):
        return Path(os.environ["UNDERCUT_MODS"])
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "undercut" / "mods"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "undercut" / "mods"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "undercut" / "mods"


def mod_roots(repo: Path | None = None) -> dict[str, Path]:
    repo = repo or resource_root()
    return {"examples": repo / "mods" / "examples", "local": repo / "mods" / "local", "user": user_mods_dir()}


def pack_bundle(folder: str) -> Path | None:
    """The `bundle.json` of the pack folder called `folder`, looked for in the user folder first and then in `mods/local`: a pack may
    bring a parameter bundle of its own for the server to use (UNDERCUT_PACK_BUNDLE names the pack). None when there is none."""
    roots = mod_roots()
    for root in (roots["user"], roots["local"]):
        path = root / folder / "bundle.json"
        if path.is_file() and not path.is_symlink():
            return path
    return None


def _pack_dirs(root: Path):
    try:
        return sorted(p for p in root.iterdir() if p.is_dir() and not p.is_symlink())
    except OSError:
        return []


def scan_mods(roots: dict[str, Path]) -> list[dict]:
    """Every pack folder in every root. A pack that cannot be used is listed with the reason, not hidden."""
    out = []
    for source, root in roots.items():
        for folder in _pack_dirs(root):
            entry = {"source": source, "folder": folder.name, "root": f"/mods/{source}/{folder.name}", "ok": False, "errors": []}
            manifest = folder / "manifest.json"
            try:
                if manifest.is_symlink() or not manifest.is_file():
                    entry["errors"].append(f"{folder.name}: manifest.json is missing")
                elif manifest.stat().st_size > MANIFEST_BYTES:
                    entry["errors"].append(f"{folder.name}:manifest.json: is larger than {MANIFEST_BYTES // 1024} KB")
                else:
                    data = json.loads(manifest.read_text(encoding="utf-8"))
                    if not isinstance(data, dict) or not isinstance(data.get("id"), str):
                        entry["errors"].append(f"{folder.name}:manifest.json.id: a pack needs a text id")
                    else:
                        for key in ("id", "name", "version", "author"):
                            if isinstance(data.get(key), str):
                                entry[key] = data[key]
                        if data.get("kind") == "mod":
                            entry["ok"] = True
                        else:
                            entry["errors"].append(f"{data['id']}:manifest.json.kind: only the built-in pack may have kind 'base' (set it to 'mod')")
            except (OSError, ValueError) as e:
                entry["errors"].append(f"{folder.name}: cannot be read ({e})")
            out.append(entry)
    return out


def path_problem(p: str) -> str | None:
    """Why a relative path is refused, or None: the rules of `pathProblem` in `client/src/packs/validate.ts`."""
    if not p:
        return "empty path"
    if "\\" in p or _CONTROL.search(p):
        return "backslash or control character"
    if p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        return "absolute path"
    if any(seg in ("", ".", "..") for seg in p.split("/")):
        return "empty, '.' or '..' segment"
    return None


def resolve_mod_file(roots: dict[str, Path], source: str, folder: str, rel: str) -> tuple[int, Path | None, str | None]:
    """(status, file, content type) for `/mods/<source>/<folder>/<rel>`."""
    if source not in roots or not folder or not rel:
        return 404, None, None
    if path_problem(rel) or path_problem(folder) or "/" in folder:
        return 400, None, None
    ext = rel.rsplit(".", 1)[-1].lower() if "." in rel else ""
    if ext not in TYPES:
        return 404, None, None
    pack = roots[source] / folder
    try:
        at = pack
        if at.is_symlink():
            return 403, None, None
        for seg in rel.split("/"):
            at = at / seg
            if at.is_symlink():
                return 403, None, None
        if not at.is_file():
            return 404, None, None
        if pack.resolve() not in at.resolve().parents:
            return 403, None, None
        return 200, at, TYPES[ext]
    except OSError:
        return 404, None, None
