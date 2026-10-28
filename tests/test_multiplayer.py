import json

import pytest
from fastapi.testclient import TestClient

from starlette.websockets import WebSocketDisconnect

from server.app import create_app
from server.protocol import ProtocolError
from server.room import AWAY_S, Room
from tests.helpers import make_bundle


def lobby(**kw):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 6
    return Room("ABCDE", b, {"seed": 3, "circuit": "Test"}, human_team="T0", multiplayer=True, **kw), b


def start(room):
    room.handle(room.host, {"type": "control", "op": "start"})


def test_players_claim_free_teams_and_each_controls_only_their_own_cars():
    room, _ = lobby()
    tok = room.claim("T1", "Sam")
    assert room.seat_ok("T1", tok) and not room.seat_ok("T1", "nope") and not room.seat_ok("T2", tok)
    with pytest.raises(ProtocolError, match="taken"):
        room.claim("T1")
    assert room.human_cars == {"T0A", "T0B", "T1A", "T1B"} and room.human_team is None
    start(room)
    room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T1A", "compound": "HARD"})
    with pytest.raises(ProtocolError, match="not one of your cars"):
        room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    with pytest.raises(ProtocolError, match="run by the AI"):
        room.handle("T5", {"type": "action", "kind": "CallBox", "car": "T5A", "compound": "HARD"})
    with pytest.raises(ProtocolError, match="started"):
        room.claim("T2")


def test_only_the_host_starts_and_nobody_pauses_during_the_race():
    room, _ = lobby()
    room.claim("T1")
    with pytest.raises(ProtocolError, match="host"):
        room.handle("T1", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 5})
    assert room.speed == 5 and not room.pause_allowed
    start(room)
    with pytest.raises(ProtocolError):
        room.handle("T0", {"type": "control", "op": "pause"})
    assert room.log.header["human_teams"] == ["T0", "T1"] and room.log.header["human_team"] is None


def test_each_team_sees_only_its_own_radio_and_own_hidden_state():
    room, _ = lobby()
    room.claim("T1")
    start(room)
    room.advance(600)
    for team in ("T0", "T1"):
        mine = room.team_cars(team)
        assert set(room.view(team)["own"]) == mine
        assert all(e["payload"].get("car") in mine for e in room.history(team) if e["type"] == "radio")


def test_a_seat_nobody_is_connected_to_is_taken_over_by_the_ai_and_handed_back_on_return():
    room, _ = lobby()
    room.claim("T1")
    start(room)
    room.set_connected("T0", True)
    room.advance(1.0)
    assert not room.humans["T1"]["auto"]
    room.advance(AWAY_S)
    assert room.humans["T1"]["auto"] and not room.policies["T1"].exclude and not room.humans["T0"]["auto"]
    room.set_connected("T1", True)
    assert room.policies["T1"].exclude == {"T1A", "T1B"} and not room.humans["T1"]["auto"]


def test_the_other_players_are_told_when_someone_drops_and_when_the_ai_takes_over_and_when_they_return():
    room, _ = lobby()
    room.claim("T1", "Sam")
    start(room)
    room.set_connected("T0", True)
    room.set_connected("T1", True)
    room.set_connected("T1", False)
    assert room.vote_note["text"] == "Sam disconnected"
    room.advance(AWAY_S + 1.0)
    assert room.vote_note["text"] == f"Sam disconnected; the AI is running {room._team_name('T1')}"
    room.set_connected("T1", True)
    assert room.vote_note["text"] == f"Sam is back and has {room._team_name('T1')} again"


def test_a_multiplayer_race_with_two_players_and_an_autopilot_stretch_replays_exactly():
    """The replay is what the debrief stands on: it must hand a seat to the AI and give it back at the ticks the room did."""
    from engine.runner import Runner
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 14
    room = Room("ABCDE", b, {"seed": 3, "circuit": "Test"}, human_team="T0", multiplayer=True)
    room.claim("T1", "Sam")
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    start(room)
    room.set_connected("T0", True)
    room.set_connected("T1", True)
    room.advance(8.0)
    room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T1A", "compound": "MEDIUM"})
    room.advance(4.0)
    room.set_connected("T1", False)
    room.advance(AWAY_S + 1.0)                                          # T1 left in the middle of the race: the AI takes the seat
    assert room.humans["T1"]["auto"]
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    room.advance(20.0)
    room.set_connected("T1", True)                                       # and gives it back
    room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T1B", "compound": "SOFT"})
    while room.race.session != "FINISHED":
        room.advance(1.0)
    kinds = [(e["payload"].get("kind"), e["payload"].get("state")) for e in room.log.events if e["type"] == "action"]
    assert ("SeatNote", "auto") in kinds and ("SeatNote", "back") in kinds
    runner = Runner.from_log(b, room.log)
    runner.run_to_end()
    assert runner.race.events == room.log.events


@pytest.fixture()
def client(tmp_path):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 3
    path = tmp_path / "b.json"
    path.write_text(json.dumps(b))
    with TestClient(create_app(path, tmp_path / "logs", time_scale=50.0)) as c:
        yield c


def test_create_join_and_play_through_the_code(client):
    made = client.post("/api/games", json={"team": "T0", "name": "Host", "circuit": "Test"}).json()
    code = made["id"]
    assert len(code) == 5 and made["multiplayer"] and made["seat"] and made["host"] == "T0"
    joined = client.post(f"/api/games/{code.lower()}/join", json={"team": "T1", "name": "Sam"})
    assert joined.status_code == 200 and joined.json()["seat"] != made["seat"]
    assert client.post(f"/api/games/{code}/join", json={"team": "T1"}).status_code == 409
    assert client.post("/api/games/ZZZZZ/join", json={"team": "T2"}).status_code == 404
    info = client.get(f"/api/games/{code}").json()
    assert [p["team"] for p in info["players"]] == ["T0", "T1"] and "seat" not in json.dumps(info)
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(f"/ws/{code}?team=T1&seat=wrong"):
        pass
    assert closed.value.code == 4403
    with client.websocket_connect(f"/ws/{code}?team=T0&seat={made['seat']}") as host, \
            client.websocket_connect(f"/ws/{code}?team=T1&seat={joined.json()['seat']}") as guest:
        assert host.receive_json()["type"] == "snapshot" and guest.receive_json()["type"] == "snapshot"
        guest.send_text(json.dumps({"type": "control", "op": "start"}))
        for _ in range(50):
            m = guest.receive_json()
            if m["type"] == "error":
                break
        assert "host" in m["message"]
        host.send_text(json.dumps({"type": "control", "op": "start"}))
        for _ in range(400):
            m = guest.receive_json()
            if m["type"] == "clock" and m["session"] == "FINISHED":
                break
        assert m["session"] == "FINISHED" and [p["connected"] for p in m["players"]] == [True, True]
    assert client.post(f"/api/races/{code}/debrief").status_code == 409


def test_solo_rooms_cannot_be_joined_and_bad_games_are_refused(client):
    solo = client.post("/api/races", json={"team": "T0"}).json()
    assert client.get(f"/api/games/{solo['id']}").status_code == 404
    assert client.post("/api/games", json={"team": "NOPE"}).status_code == 422


def test_each_player_is_told_only_their_own_cars_are_theirs():
    room, _ = lobby()
    room.claim("T1", "Sam")
    assert room.info("T0")["human_cars"] == ["T0A", "T0B"] and room.info("T0")["human_team"] == "T0"
    assert room.info("T1")["human_cars"] == ["T1A", "T1B"] and room.info("T1")["human_team"] == "T1"
    assert room.info()["human_cars"] == ["T0A", "T0B", "T1A", "T1B"] and room.info()["human_team"] is None      # the lobby listing


def test_the_snapshot_a_joiner_gets_lists_only_their_cars(client):
    made = client.post("/api/games", json={"team": "T0", "name": "Host", "circuit": "Test"}).json()
    joined = client.post(f"/api/games/{made['id']}/join", json={"team": "T1", "name": "Sam"}).json()
    assert joined["human_cars"] == ["T1A", "T1B"] and made["human_cars"] == ["T0A", "T0B"]
    with client.websocket_connect(f"/ws/{made['id']}?team=T1&seat={joined['seat']}") as ws:
        snap = ws.receive_json()
    assert snap["info"]["human_cars"] == ["T1A", "T1B"] and snap["info"]["human_team"] == "T1"


def racing(*teams):
    """A started multiplayer race with these teams seated and connected, at speed 2."""
    room, _ = lobby()
    for t in teams[1:]:
        room.claim(t, t.lower())
    for t in teams:
        room.set_connected(t, True)
    room.handle("T0", {"type": "control", "op": "speed", "value": 2})
    start(room)
    return room


def speed(room, team, value):
    room.handle(team, {"type": "control", "op": "speed", "value": value})


def vote(room, team, answer):
    room.handle(team, {"type": "control", "op": "vote", "answer": answer})


def test_a_speed_increase_waits_for_every_connected_player():
    room = racing("T0", "T1", "T2")
    speed(room, "T1", 5)
    assert room.speed == 2 and room.vote_view()["waiting"] == ["T0", "T2"] and room.vote_view()["to"] == 5
    assert "wants to increase speed to 5x" in room.vote_note["text"]
    vote(room, "T0", "yes")
    assert room.speed == 2 and room.vote_view()["waiting_names"] == ["t2"]
    vote(room, "T2", "yes")
    assert room.speed == 5 and room.vote_view() is None and room.vote_note["text"] == "Speed increased to 5x"


def test_one_no_ends_the_vote_and_the_speed_stays():
    room = racing("T0", "T1")
    speed(room, "T0", 10)
    vote(room, "T1", "no")
    assert room.speed == 2 and room.vote_view() is None and "t1 declined" in room.vote_note["text"]
    with pytest.raises(ProtocolError, match="no speed vote"):
        vote(room, "T1", "yes")


def test_slowing_down_is_immediate_for_everyone_and_ends_a_pending_vote():
    room = racing("T0", "T1")
    speed(room, "T0", 10)
    assert room.vote_view() is not None
    speed(room, "T1", 1)
    assert room.speed == 1 and room.vote_view() is None and "slowed the race to 1x" in room.vote_note["text"]


def test_a_player_who_leaves_no_longer_holds_the_vote_up():
    room = racing("T0", "T1", "T2")
    speed(room, "T0", 5)
    vote(room, "T1", "yes")
    assert room.speed == 2
    room.set_connected("T2", False)
    assert room.speed == 5 and room.vote_view() is None


def test_the_proposer_cannot_vote_a_lone_player_gets_it_at_once_and_a_request_can_be_withdrawn():
    room = racing("T0")
    speed(room, "T0", 5)
    assert room.speed == 5
    room = racing("T0", "T1")
    speed(room, "T0", 10)
    with pytest.raises(ProtocolError, match="not asked"):
        vote(room, "T0", "yes")
    speed(room, "T0", 2)
    assert room.vote_view() is None and "withdrew" in room.vote_note["text"]


def test_the_vote_reaches_every_player_in_the_clock_message():
    from server.protocol import clock_message
    room = racing("T0", "T1")
    speed(room, "T1", 5)
    msg = clock_message(room)
    assert msg["vote"]["by"] == "T1" and msg["vote"]["waiting"] == ["T0"] and msg["vote_note"]["id"] > 0


def test_a_speed_vote_goes_over_the_sockets_to_both_players(client):
    made = client.post("/api/games", json={"team": "T0", "name": "Ann", "circuit": "Test"}).json()
    code = made["id"]
    joined = client.post(f"/api/games/{code}/join", json={"team": "T1", "name": "Sam"}).json()
    send = lambda ws, **m: ws.send_text(json.dumps({"type": "control", **m}))

    def until(ws, test, n=600):
        for _ in range(n):
            m = ws.receive_json()
            if m["type"] == "clock" and test(m):
                return m
        raise AssertionError("never seen")

    with client.websocket_connect(f"/ws/{code}?team=T0&seat={made['seat']}") as host, \
            client.websocket_connect(f"/ws/{code}?team=T1&seat={joined['seat']}") as guest:
        host.receive_json(), guest.receive_json()
        send(host, op="start")
        until(guest, lambda m: m["session"] == "RACING")
        send(guest, op="speed", value=10)
        asked = until(host, lambda m: m["vote"] is not None)
        assert asked["vote"]["by_name"] == "Sam" and asked["vote"]["waiting_names"] == ["Ann"] and asked["speed"] != 10
        send(host, op="vote", answer="yes")
        done = until(guest, lambda m: m["vote"] is None and m["speed"] == 10)
        assert done["vote_note"]["text"] == "Speed increased to 10x"
        send(host, op="speed", value=1)
        slow = until(guest, lambda m: m["speed"] == 1)
        assert "Ann slowed the race to 1x" in slow["vote_note"]["text"]
