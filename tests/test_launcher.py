import socket
import subprocess
import sys
import time
import urllib.request

import pytest

from server import paths
from server.launcher import free_port, running_here


def test_resources_come_from_the_repository_in_development_and_the_bundle_folder_when_frozen(monkeypatch, tmp_path):
    assert paths.resource_root() == paths.REPO and not paths.frozen()
    assert paths.default_bundle().exists() and paths.default_log_dir() == paths.REPO / "logs"
    monkeypatch.setattr(paths.sys, "frozen", True, raising=False)
    monkeypatch.setattr(paths.sys, "_MEIPASS", str(tmp_path), raising=False)
    assert paths.frozen() and paths.resource_root() == tmp_path
    assert paths.default_bundle() == tmp_path / "params" / "bundles" / "1.0.0.json"
    monkeypatch.setenv("UNDERCUT_DATA", str(tmp_path / "data"))
    assert paths.default_log_dir() == tmp_path / "data" / "logs"          # player data never goes inside the bundle folder


def test_the_data_folder_is_per_user_and_can_be_overridden(monkeypatch, tmp_path):
    monkeypatch.delenv("UNDERCUT_DATA", raising=False)
    monkeypatch.setattr(paths.sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    assert paths.data_dir() == tmp_path / "undercut"
    monkeypatch.setenv("UNDERCUT_DATA", str(tmp_path / "x"))
    assert paths.data_dir() == tmp_path / "x"


def test_free_port_prefers_the_asked_port_and_falls_back_to_another():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        taken = probe.getsockname()[1]
        assert free_port(taken) != taken                                  # in use: any other port
    assert free_port(taken) == taken                                      # free again


def test_no_server_is_detected_on_a_quiet_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert not running_here(port)


@pytest.mark.slow
@pytest.mark.parametrize("lan", [False, True])
def test_the_launcher_starts_the_server_on_localhost_only_and_serves_the_game(tmp_path, lan):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {"UNDERCUT_DATA": str(tmp_path), "PATH": "/usr/bin:/bin"}
    proc = subprocess.Popen([sys.executable, "-m", "server.launcher", "--port", str(port), "--no-browser", *(["--lan"] if lan else [])], env=env,
                            cwd=paths.REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if running_here(port):
                break
            time.sleep(0.2)
        assert running_here(port)
        listening = subprocess.run(["ss", "-ltn"], capture_output=True, text=True, check=False).stdout
        if lan:                                                           # opt in: every interface, friends can reach it
            assert f"0.0.0.0:{port}" in listening or f"*:{port}" in listening
        else:
            assert f"127.0.0.1:{port}" in listening and f"0.0.0.0:{port}" not in listening
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/options", timeout=3) as r:
            assert b"austin" in r.read()
    finally:
        proc.terminate()
        proc.wait(10)
