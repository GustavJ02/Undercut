"""Box opposite: the driver settles the call at his own pit entry, by what the rival ahead did."""
import pytest

from engine.runner import Runner
from server.protocol import ProtocolError
from server.room import Room
from tests.helpers import make_bundle


def msg(**kw):
    return {"type": "action", **kw}


def started(laps=14):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    b["teams"][0]["pace_delta_s"] += 6.0                       # the human team starts at the back, so there are rivals ahead
    room = Room("o1", b, {"seed": 3, "circuit": "Test"}, human_team="T0")
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(30.0)
    return room, b


def rival_ahead(room, car="T0A"):
    me = room.race.cars[car]
    ahead = [c for c in room.race.cars.values() if c.team != "T0" and c.status == "RUNNING" and 0 < c.progress - me.progress < 1]
    return min(ahead, key=lambda c: c.progress - me.progress).id


def call(room, rival, compound="HARD"):
    room.handle("T0", msg(kind="BoxOpposite", car="T0A", target=rival, compound=compound))
    return room.advance(0.1)


def run_until_settled(room, limit=400):
    events = []
    for _ in range(limit):
        events += room.advance(1.0)
        if room.race.cars["T0A"].opposite is None:
            break
    return events


def surname(room, car_id):
    """The name a line of text uses for a car: its driver's surname, never the id."""
    return room.race.cars[car_id].driver.split()[-1]


def texts(room, events):
    return [e["payload"]["message"] for e in room.events_for("T0", events) if e["type"] == "box_ack" and e["payload"]["car"] == "T0A"]


def test_the_call_is_checked_and_shown_in_the_view():
    room, _ = started()
    rival = rival_ahead(room)
    with pytest.raises(ProtocolError, match="rival"):
        room.handle("T0", msg(kind="BoxOpposite", car="T0A", target="T0B", compound="HARD"))
    with pytest.raises(ProtocolError, match="compound"):
        room.handle("T0", msg(kind="BoxOpposite", car="T0A", target=rival, compound="SLICK"))
    ev = call(room, rival)
    assert f"Box opposite {surname(room, rival)}" in texts(room, ev)[0]
    assert room.view("T0")["own"]["T0A"]["order"] == {"target": rival, "compound": "HARD"}
    assert room.view("T0")["own"]["T0B"]["order"] is None
    ev = room.handle("T0", msg(kind="BoxOpposite", car="T0A", target=rival, compound="HARD")) or room.advance(0.1)
    assert "cancel the current call" in texts(room, ev)[0]
    room.handle("T0", msg(kind="CancelBox", car="T0A"))
    ev = room.advance(0.1)
    assert "cancelled" in texts(room, ev)[0] and room.view("T0")["own"]["T0A"]["order"] is None


def test_nothing_is_decided_before_the_pit_entry():
    room, _ = started()
    call(room, rival_ahead(room))
    assert room.race.cars["T0A"].box_call is None and room.race.cars["T0A"].opposite is not None


def test_the_driver_boxes_when_the_rival_stays_out_and_the_race_replays_exactly():
    room, b = started()
    rival = rival_ahead(room)
    call(room, rival)
    events = run_until_settled(room)
    assert f"{surname(room, rival)} stayed out: box, hard" in texts(room, events)
    assert room.race.cars["T0A"].box_call is not None or room.race.cars["T0A"].stops == 1
    while room.race.session != "FINISHED":
        room.advance(1.0)
    assert room.race.cars["T0A"].stops >= 1
    runner = Runner.from_log(b, room.log)
    runner.run_to_end()
    assert runner.race.events == room.race.events


def test_the_driver_stays_out_when_the_rival_boxes():
    room, _ = started()
    rival = rival_ahead(room)
    room.race.cars[rival].box_call = {"compound": "HARD", "effective_lap": 0}        # it is on its way in
    call(room, rival)
    events = run_until_settled(room)
    assert f"{surname(room, rival)} has boxed: stay out" in texts(room, events)
    assert room.race.cars["T0A"].box_call is None and room.race.cars["T0A"].stops == 0


def test_a_call_made_while_paused_shows_at_once_and_a_second_click_does_nothing():
    room, _ = started()
    room.handle("T0", {"type": "control", "op": "pause"})
    tick_before, n_before = room.race.tick, len(room.race.events)
    first = room.handle("T0", msg(kind="CallBox", car="T0A", compound="SOFT"))
    assert room.view("T0")["own"]["T0A"]["box_call"]["compound"] == "SOFT"
    assert len(texts(room, first)) == 1
    room.handle("T0", msg(kind="CancelBox", car="T0A"))
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="SOFT"))
    assert room.race.tick == tick_before
    acks = [e for e in room.race.events[n_before:] if e["type"] == "box_ack"]
    assert len(acks) == 3
    room.handle("T0", {"type": "control", "op": "resume"})
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))
    assert room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD")) in (None, [])
    assert room.pending.count(room.pending[0]) == 1 and len(room.pending) == 1
