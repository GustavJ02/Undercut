"""Write NOTICES-server.txt: the licence notices of the Python packages the server runs on (requirements.txt and what they need).

    venv/bin/python -m tools.make_notices

The result is committed; the client build appends it to the notices it ships (client/scripts/make-notices.mjs).
"""
import re
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def requirement_names(path: Path) -> list[str]:
    names = []
    for line in path.read_text().splitlines():
        line = line.split("#")[0].strip()
        if line:
            names.append(re.split(r"[\[=<>!~ ;]", line)[0])
    return names


def closure(roots: list[str]) -> dict[str, metadata.Distribution]:
    out: dict[str, metadata.Distribution] = {}
    todo = list(roots)
    while todo:
        name = todo.pop()
        key = re.sub(r"[-_.]+", "-", name).lower()
        if key in out:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        out[key] = dist
        for req in dist.requires or []:
            if "extra ==" in req:
                continue
            todo.append(re.split(r"[\[=<>!~ ;(]", req)[0])
    return out


def licence_of(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    return meta.get("License-Expression") or (meta.get("License") or "").splitlines()[0][:80] or next(
        (c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")), "unknown")


def licence_text(dist: metadata.Distribution) -> str | None:
    for f in dist.files or []:
        if re.search(r"(^|/)(licen[sc]e|copying|notice)[^/]*$", str(f), re.I):
            try:
                return dist.locate_file(f).read_text(errors="replace").strip()
            except OSError:
                continue
    return None


def main():
    dists = closure(requirement_names(ROOT / "requirements.txt"))
    parts = ["Python packages the server runs on", ""]
    for key in sorted(dists):
        d = dists[key]
        text = licence_text(d)
        parts += ["=" * 78, f"{d.metadata['Name']} {d.version}  ({licence_of(d)})", d.metadata.get("Home-page") or "", "",
                  text or f"Licence: {licence_of(d)}. The package ships no licence file.", ""]
    (ROOT / "NOTICES-server.txt").write_text("\n".join(parts) + "\n")
    print(f"NOTICES-server.txt: {len(dists)} packages")


if __name__ == "__main__":
    main()
