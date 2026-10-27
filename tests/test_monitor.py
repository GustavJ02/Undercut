import json
import time

from server import monitor, stats
from server.room import Room
from tests.helpers import make_bundle


def test_the_snapshot_counts_solo_and_multiplayer_games_and_holds_no_secrets(tmp_path):
    b = make_bundle()
    solo = Room("s1", b, {"seed": 1, "circuit": "Test"}, human_team="T0", log_dir=tmp_path)
    multi = Room("ABCDE", b, {"seed": 2, "circuit": "Test"}, human_team="T0", log_dir=tmp_path, multiplayer=True, host_name="Ann")
    snap = stats.snapshot({"s1": solo, "ABCDE": multi}, {"s1": {object(): "T0"}, "ABCDE": {}}, {}, {"s1": 0.02}, time.time() - 5, 20, 2)
    kinds = {r["id"]: r for r in snap["rooms"]}
    assert kinds["s1"]["kind"] == "solo" and kinds["s1"]["clients"] == 1 and kinds["s1"]["busy"] == 0.02
    assert kinds["ABCDE"]["kind"] == "multi" and kinds["ABCDE"]["players"] == 1 and kinds["ABCDE"]["players_connected"] == 0
    assert multi.humans["T0"]["token"] not in json.dumps(snap)


def test_the_monitor_prints_a_snapshot_from_the_stats_file(tmp_path, monkeypatch, capsys):
    b = make_bundle()
    room = Room("s1", b, {"seed": 1, "circuit": "Test"}, human_team="T0", log_dir=tmp_path)
    path = tmp_path / "stats.json"
    path.write_text(json.dumps(stats.snapshot({"s1": room}, {"s1": {}}, {}, {}, time.time(), 20, 2)))
    monkeypatch.setattr(monitor, "STATS", path)
    monitor.main(["--once"])
    out = capsys.readouterr().out
    assert "Singleplayer 1" in out and "Multiplayer 0" in out and "s1" in out and "CPU" in out
    path.write_text(json.dumps({**json.loads(path.read_text()), "time": time.time() - 60}))
    monitor.main(["--once"])
    assert "has not reported" in capsys.readouterr().out
