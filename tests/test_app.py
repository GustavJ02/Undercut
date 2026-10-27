import json

import pytest
from fastapi.testclient import TestClient

from engine.bundle import validate_bundle  # noqa: F401
from server.app import create_app
from tests.helpers import make_bundle


@pytest.fixture()
def client(tmp_path):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 3
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", time_scale=50.0)) as c:      # keeps one event loop alive
        yield c


def new(client, **kw):
    r = client.post("/api/races", json={"team": "T0", "speed": 10, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_options_and_race_creation_validate_their_input(client):
    assert {t["id"] for t in client.get("/api/options").json()["teams"]} >= {"T0", "T9"}
    assert client.post("/api/races", json={"team": "NOPE"}).status_code == 422
    assert client.post("/api/races", json={"team": "T0", "circuit": "Atlantis"}).status_code == 422
    assert client.post("/api/races", json={"team": "T0", "speed": 3}).status_code == 422
    assert client.get("/api/races/missing").status_code == 404
    assert new(client)["human_cars"] == ["T0A", "T0B"]


def test_options_describe_the_circuits_without_hidden_parameters_and_chaos_values_are_checked(client):
    info = client.get("/api/options").json()["circuit_info"]
    assert info and all(set(v) == {"lap_length_m", "corners", "sc_rate_per_lap"} for v in info.values())
    ok = {"team": "T0", "incident_multipliers": {"incident_rate": 2.5, "sc_response_bias": 0}}
    assert client.post("/api/races", json=ok).status_code == 200
    assert client.post("/api/races", json={"team": "T0", "incident_multipliers": {"incident_rate": 99}}).status_code == 422
    assert client.post("/api/races", json={"team": "T0", "incident_multipliers": {"nonsense": 1}}).status_code == 422


def until(ws, pred, limit=4000):
    """Read messages until one matches; the server also pushes state and clock messages at any time."""
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if pred(m):
            return m, seen
    raise AssertionError("expected message never arrived")


def test_websocket_snapshot_then_play_a_race_with_a_pit_call(client):
    info = new(client)
    with client.websocket_connect(f"/ws/{info['id']}?team=T0") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and snap["view"]["session"] == "GRID" and "T0A" in snap["view"]["own"]
        ws.send_json({"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "HARD"})
        ws.send_json({"type": "action", "kind": "CallBox", "car": "T1A", "compound": "HARD"})
        err, _ = until(ws, lambda m: m["type"] == "error")
        assert err["message"] == "'T1A' is not one of your cars"
        ws.send_json({"type": "control", "op": "start"})
        until(ws, lambda m: m["type"] == "clock" and m["session"] == "RACING")
        ws.send_json({"type": "action", "kind": "CallBox", "car": "T0A", "compound": "MEDIUM"})
        _, seen = until(ws, lambda m: m["type"] == "event" and m["event"]["type"] == "classification")
        assert any(m["type"] == "event" and m["event"]["type"] == "box_ack" for m in seen)
        assert not any(m["type"] == "event" and m["event"]["type"] == "action" for m in seen)
        assert any(m["type"] == "state" and m["view"]["session"] == "RACING" for m in seen)


def test_a_client_cannot_join_as_an_unknown_team_or_command_an_ai_team(client):
    info = new(client)
    with pytest.raises(Exception), client.websocket_connect(f"/ws/{info['id']}?team=NOPE") as ws:  # noqa: B017 (closed with 4404)
        ws.receive_json()
    with client.websocket_connect(f"/ws/{info['id']}?team=T3") as ws:
        ws.receive_json()
        ws.send_json({"type": "control", "op": "start"})
        err, _ = until(ws, lambda m: m["type"] == "error")
        assert "run by the AI" in err["message"]


def test_debrief_is_refused_during_the_race_then_computed_after_it(client):
    import time
    info = new(client, laps=3, speed=10)
    room_id = info["id"]
    assert client.post(f"/api/races/{room_id}/debrief").status_code == 409
    assert client.get(f"/api/races/{room_id}/debrief").status_code == 409
    with client.websocket_connect(f"/ws/{room_id}?team=T0") as ws:
        ws.receive_json()
        ws.send_json({"type": "control", "op": "start"})
        until(ws, lambda m: m["type"] == "clock" and m["session"] == "RACING")
        ws.send_json({"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
        until(ws, lambda m: m["type"] == "event" and m["event"]["type"] == "classification")
    assert client.post(f"/api/races/{room_id}/debrief?futures=2").json()["status"] == "running"
    for _ in range(600):
        r = client.get(f"/api/races/{room_id}/debrief").json()
        if r["status"] != "running":
            break
        time.sleep(0.2)
    assert r["status"] == "done", r
    assert {"summary", "decisions"} <= set(r["report"]) and r["report"]["team"] == "T0"
    # regression: the alternatives of a pit call must not all give the same result (the recorded call was once applied in each)
    calls = [d for d in r["report"]["decisions"] if d["kind"] == "call"]
    assert calls
    options = calls[0]["options"]
    assert len({(round(o["points"], 6), round(o["places"], 6)) for o in options}) > 1, options


def test_weather_can_be_chosen_when_the_race_is_created_and_is_visible_to_the_client(client):
    assert client.post("/api/races", json={"team": "T0", "weather": "snow"}).status_code == 422
    info = new(client, weather="wet_start", laps=3)
    with client.websocket_connect(f"/ws/{info['id']}?team=T0") as ws:
        snap = ws.receive_json()
    w = snap["view"]["weather"]
    assert w["track"] in ("damp", "wet") and set(w) == {"raining", "track", "wet_race_declared", "forecast_pre_race_pct", "forecast_next_laps"}
    assert len(w["forecast_next_laps"]) == 10
    dry = new(client, laps=3)
    with client.websocket_connect(f"/ws/{dry['id']}?team=T0") as ws:
        assert ws.receive_json()["view"]["weather"]["track"] == "dry"


def test_a_room_nobody_is_connected_to_is_forgotten_after_its_time_to_live_but_not_while_someone_is_there(tmp_path):
    import time
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 3
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", time_scale=50.0, room_ttl_s=0.6)) as c:
        info = c.post("/api/races", json={"team": "T0", "speed": 10, "laps": 3}).json()
        with c.websocket_connect(f"/ws/{info['id']}?team=T0") as ws:
            time.sleep(1.2)                                   # connected the whole time: the room stays
            assert c.get(f"/api/races/{info['id']}").status_code == 200
        for _ in range(40):                                   # gone a moment after the last client left
            if c.get(f"/api/races/{info['id']}").status_code == 404:
                break
            time.sleep(0.1)
        assert c.get(f"/api/races/{info['id']}").status_code == 404
