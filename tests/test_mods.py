import json
import os

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.mods import path_problem, resolve_mod_file, scan_mods, user_mods_dir
from tests.helpers import make_bundle


def pack(root, folder, kind="mod", **extra):
    d = root / folder
    (d / "assets").mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"id": folder, "name": f"Pack {folder}", "version": "1.0.0", "author": "me", "kind": kind, **extra}))
    (d / "assets" / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (d / "assets" / "notes.txt").write_text("not served")
    return d


@pytest.fixture()
def roots(tmp_path):
    user, examples = tmp_path / "user", tmp_path / "examples"
    user.mkdir(), examples.mkdir()
    pack(user, "neon")
    pack(examples, "builtin", kind="base")
    broken = user / "broken"
    broken.mkdir()
    (broken / "manifest.json").write_text("{ not json")
    (user / "empty").mkdir()
    return {"examples": examples, "local": tmp_path / "missing", "user": user}


@pytest.fixture()
def client(tmp_path, roots):
    b = make_bundle()
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", mods=roots)) as c:
        yield c


def test_the_list_names_usable_packs_and_gives_the_reason_for_the_others(roots):
    by = {(e["source"], e["folder"]): e for e in scan_mods(roots)}
    neon = by[("user", "neon")]
    assert neon["ok"] and neon["id"] == "neon" and neon["name"] == "Pack neon" and neon["root"] == "/mods/user/neon" and neon["errors"] == []
    assert not by[("examples", "builtin")]["ok"] and "kind" in by[("examples", "builtin")]["errors"][0]
    assert not by[("user", "broken")]["ok"] and "cannot be read" in by[("user", "broken")]["errors"][0]
    assert not by[("user", "empty")]["ok"] and "manifest.json is missing" in by[("user", "empty")]["errors"][0]
    assert not any(k[0] == "local" for k in by)               # a folder that is not there is not an error


def test_the_routes_serve_the_list_and_only_data_files_of_a_pack(client):
    index = client.get("/mods/index.json")
    assert index.status_code == 200 and index.headers["content-type"].startswith("application/json")
    assert {p["folder"] for p in index.json()["packs"]} >= {"neon", "broken"}
    ok = client.get("/mods/user/neon/assets/a.png")
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/png" and ok.content.startswith(b"\x89PNG")
    assert client.get("/mods/user/neon/manifest.json").status_code == 200
    assert client.get("/mods/user/neon/assets/notes.txt").status_code == 404          # not a pack file type
    assert client.get("/mods/user/neon/assets/missing.png").status_code == 404
    assert client.get("/mods/nowhere/neon/assets/a.png").status_code == 404


def test_paths_that_leave_the_pack_or_follow_links_are_refused(roots, tmp_path):
    secret = tmp_path / "secret.json"
    secret.write_text("{}")
    neon = roots["user"] / "neon"
    try:
        os.symlink(secret, neon / "assets" / "link.json")
        os.symlink(tmp_path, neon / "assets" / "dir")
    except OSError:
        pytest.skip("no symbolic links here")
    assert resolve_mod_file(roots, "user", "neon", "assets/link.json")[0] == 403
    assert resolve_mod_file(roots, "user", "neon", "assets/dir/secret.json")[0] == 403
    for bad in ("../broken/manifest.json", "assets/../manifest.json", "/etc/passwd", "assets\\a.png", "assets//a.png", "a\x00.png"):
        assert resolve_mod_file(roots, "user", "neon", bad)[0] in (400, 404), bad
    assert resolve_mod_file(roots, "user", "../user", "manifest.json")[0] == 400
    assert path_problem("assets/ok.png") is None


def test_the_user_folder_can_be_moved_with_an_environment_variable(monkeypatch, tmp_path):
    monkeypatch.setenv("UNDERCUT_MODS", str(tmp_path / "m"))
    assert user_mods_dir() == tmp_path / "m"


def test_a_pack_can_bring_a_bundle_and_the_server_finds_it_by_the_packs_folder_name(tmp_path, monkeypatch):
    from server.mods import pack_bundle
    pack = tmp_path / "some-pack"
    pack.mkdir()
    monkeypatch.setenv("UNDERCUT_MODS", str(tmp_path))
    assert pack_bundle("some-pack") is None
    (pack / "bundle.json").write_text("{}")
    assert pack_bundle("some-pack") == pack / "bundle.json"
    assert pack_bundle("other-pack") is None
