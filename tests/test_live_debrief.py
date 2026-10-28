"""The debrief computed during the race is the debrief of the finished race: the same numbers, decision by decision."""
import json

from scoring.debrief import run_debrief_all
from scoring.live import LiveDebrief
from server.room import AWAY_S, Room
from tests.helpers import make_bundle

FUTURES = 3


def same(a, b):
    return json.dumps(a, sort_keys=True, default=float) == json.dumps(b, sort_keys=True, default=float)


def finish(room):
    while room.race.session != "FINISHED":
        room.advance(1.0)


def solo(laps=10, seed=4):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    room = Room("s1", b, {"seed": seed, "circuit": "Test"}, human_team="T0")
    room.live = LiveDebrief(b, None, FUTURES)
    room.handle("T0", {"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "SOFT"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.handle("T0", {"type": "control", "op": "start"})
    return room, b


def test_a_solo_race_debriefed_live_gives_the_same_report_as_the_finished_log():
    room, b = solo()
    room.advance(15.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    room.advance(8.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0B", "compound": "SOFT"})
    finish(room)
    live = room.live.reports()
    assert room.live.ok and set(live) == {"T0"}
    assert len(live["T0"]["decisions"]) >= 4
    assert same(live, run_debrief_all(b, room.log, FUTURES))


def test_a_call_made_while_paused_and_a_cancel_are_debriefed_live_too():
    room, b = solo(laps=12, seed=6)
    room.advance(12.0)
    room.handle("T0", {"type": "control", "op": "pause"})
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "MEDIUM"})
    room.handle("T0", {"type": "control", "op": "resume"})
    room.advance(3.0)
    room.handle("T0", {"type": "action", "kind": "CancelBox", "car": "T0A"})
    finish(room)
    assert same(room.live.reports(), run_debrief_all(b, room.log, FUTURES))


def test_a_multiplayer_race_is_debriefed_live_for_every_player_and_matches_the_log():
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 12
    room = Room("m1", b, {"seed": 5, "circuit": "Test"}, human_team="T0", multiplayer=True)
    room.live = LiveDebrief(b, None, FUTURES)
    room.claim("T1", "Sam")
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.handle("T0", {"type": "control", "op": "start"})
    room.set_connected("T0", True)
    room.set_connected("T1", True)
    room.advance(12.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    room.advance(5.0)
    room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T1B", "compound": "SOFT"})
    room.advance(3.0)
    room.set_connected("T1", False)
    room.advance(AWAY_S + 1.0)
    room.set_connected("T1", True)
    finish(room)
    live = room.live.reports()
    assert set(live) == {"T0", "T1"}
    assert same(live, run_debrief_all(b, room.log, FUTURES))


def test_a_race_without_a_live_debrief_is_unchanged_and_a_failed_one_says_so():
    room, b = solo(laps=6)
    room.live.failed = "boom"
    finish(room)
    try:
        room.live.reports()
    except Exception as e:  # noqa: BLE001
        assert "boom" in str(e)
    else:
        raise AssertionError("a failed live debrief must raise so the caller falls back to the log")


# -- through the app: the result is ready when the race is over, and a multiplayer game ranks its strategists --------------------

import time  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server.app import create_app  # noqa: E402


@pytest.fixture()
def live_client(tmp_path):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 4
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", time_scale=50.0, live_debrief=True)) as c:
        yield c


def wait_done(client, url, tries=600):
    for _ in range(tries):
        r = client.get(url)
        if r.status_code == 200 and r.json().get("status") == "done":
            return r.json()
        assert r.status_code in (200, 409), r.text
        time.sleep(0.2)
    raise AssertionError(f"{url} never finished")


def test_a_solo_debrief_starts_by_itself_at_the_flag_and_is_ready_without_a_request(live_client):
    c = live_client
    info = c.post("/api/races", json={"team": "T0", "speed": 10, "laps": 4}).json()
    with c.websocket_connect(f"/ws/{info['id']}?team=T0") as ws:
        ws.receive_json()
        ws.send_json({"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
        ws.send_json({"type": "control", "op": "start"})
        for _ in range(20000):
            m = ws.receive_json()
            if m["type"] == "event" and m["event"]["type"] == "classification":
                break
    done = wait_done(c, f"/api/races/{info['id']}/debrief")
    assert done["report"]["summary"]["score"] >= 0 and done["report"]["decisions"]


def test_a_multiplayer_game_ranks_its_strategists_and_each_player_reads_only_their_own_debrief(live_client):
    c = live_client
    made = c.post("/api/games", json={"team": "T0", "name": "Host", "circuit": "Test", "laps": 4}).json()
    code, seat0 = made["id"], made["seat"]
    joined = c.post(f"/api/games/{code}/join", json={"team": "T1", "name": "Sam"}).json()
    seat1 = joined["seat"]
    assert c.get(f"/api/games/{code}/ranking").status_code == 409                    # nothing to rank during the race
    with c.websocket_connect(f"/ws/{code}?team=T0&seat={seat0}") as w0, c.websocket_connect(f"/ws/{code}?team=T1&seat={seat1}") as w1:
        w0.receive_json()
        w1.receive_json()
        w1.send_json({"type": "action", "kind": "SetStartTyres", "car": "T1A", "compound": "SOFT"})
        w0.send_json({"type": "control", "op": "speed", "value": 10})
        w0.send_json({"type": "control", "op": "start"})
        for _ in range(20000):
            m = w0.receive_json()
            if m["type"] == "event" and m["event"]["type"] == "classification":
                break
    ranking = wait_done(c, f"/api/games/{code}/ranking")
    assert [r["team"] for r in ranking["ranking"]] == sorted((r["team"] for r in ranking["ranking"]), key=lambda t: -next(r["score"] for r in ranking["ranking"] if r["team"] == t))
    assert {r["team"] for r in ranking["ranking"]} == {"T0", "T1"} and ranking["winner"] == ranking["ranking"][0]["team"]
    assert all(0 <= r["score"] <= 100 for r in ranking["ranking"])
    mine = wait_done(c, f"/api/games/{code}/debrief?team=T1&seat={seat1}")
    assert mine["report"]["team"] == "T1" and mine["report"]["decisions"]
    assert c.get(f"/api/games/{code}/debrief?team=T1&seat={seat0}").status_code == 403         # another player's seat
    assert c.get(f"/api/games/{code}/debrief?team=T1").status_code == 403


def test_stopping_the_server_stops_the_debrief_workers(tmp_path):
    """Regression: the pool's worker processes outlived the server and kept holding its port."""
    import multiprocessing
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 3
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", time_scale=50.0, live_debrief=True)) as c:
        info = c.post("/api/races", json={"team": "T0", "speed": 10, "laps": 3}).json()
        with c.websocket_connect(f"/ws/{info['id']}?team=T0") as ws:
            ws.receive_json()
            ws.send_json({"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
            ws.send_json({"type": "control", "op": "start"})
            for _ in range(20000):
                m = ws.receive_json()
                if m["type"] == "event" and m["event"]["type"] == "classification":
                    break
        wait_done(c, f"/api/races/{info['id']}/debrief")
        assert multiprocessing.active_children()                       # the pool is up
    for _ in range(50):
        if not multiprocessing.active_children():
            break
        time.sleep(0.1)
    assert not multiprocessing.active_children()
