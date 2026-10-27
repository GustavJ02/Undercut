import json

import pytest

from engine.race import replay
from server.protocol import ProtocolError
from server.room import Room
from tests.helpers import make_bundle


def make_room(tmp_path=None, **kw):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 6
    kw.setdefault("human_team", "T0")
    return Room("r1", b, {"seed": 3, "circuit": "Test"}, log_dir=tmp_path, **kw), b


def msg(**kw):
    return {"type": "action", **kw}


def test_a_new_room_waits_on_the_grid_and_the_view_uses_grid_order():
    room, _ = make_room()
    assert room.race.session == "GRID" and room.paused
    assert [c["id"] for c in room.view("T0")["cars"]] == room.race.grid
    assert room.advance(5.0) == [] and room.race.tick == 0


def test_start_tyres_are_validated_then_the_race_starts_and_the_clock_runs():
    room, _ = make_room()
    room.handle("T0", msg(kind="SetStartTyres", car="T0A", compound="HARD"))
    with pytest.raises(ProtocolError):
        room.handle("T0", msg(kind="SetStartTyres", car="T1A", compound="HARD"))   # not our car
    with pytest.raises(ProtocolError):
        room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))         # not before lights out
    room.handle("T0", {"type": "control", "op": "start"})
    assert room.race.session == "RACING" and room.race.cars["T0A"].compound == "HARD"
    room.advance(1.0)
    assert room.race.tick == 2                      # speed 1 at dt 0.5 s: two ticks per real second
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(1.0)
    assert room.race.tick == 22


def test_pause_resume_and_the_pause_not_allowed_option():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "pause"})
    room.advance(3.0)
    assert room.race.tick == 0
    room.handle("T0", {"type": "control", "op": "resume"})
    room.advance(1.0)
    assert room.race.tick == 2
    strict, _ = make_room(pause_allowed=False)
    strict.handle("T0", {"type": "control", "op": "start"})
    with pytest.raises(ProtocolError, match="not allowed"):
        strict.handle("T0", {"type": "control", "op": "pause"})
    with pytest.raises(ProtocolError):
        strict.handle("T0", {"type": "control", "op": "speed", "value": 3})


def test_a_team_can_only_act_for_its_own_cars_and_the_ack_goes_to_that_team_only():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    with pytest.raises(ProtocolError, match="not one of your cars"):
        room.handle("T0", msg(kind="CallBox", car="T1A", compound="HARD"))
    with pytest.raises(ProtocolError, match="unknown compound"):
        room.handle("T0", msg(kind="CallBox", car="T0A", compound="GREEN"))
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))
    events = room.advance(2.0)
    mine, theirs = room.events_for("T0", events), room.events_for("T1", events)
    assert any(e["type"] == "box_ack" for e in mine)
    assert not any(e["type"] in ("box_ack", "action") for e in theirs)


def test_events_leak_nothing_beyond_public_timing():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    seen = []
    while room.race.session != "FINISHED":
        seen += room.advance(1.0)
    spectator = room.events_for("SPECTATOR", seen)
    assert spectator
    allowed = {"tick", "type", "payload"}
    for e in spectator:
        assert set(e) == allowed
        assert e["type"] not in ("action", "box_ack", "damage", "radio")
        assert not ({"duration", "p_lap", "cause"} & set(e["payload"]))
    text = json.dumps(spectator)
    assert "unattributed" not in text and "stopped on track" not in text
    pit_in = [e for e in spectator if e["type"] == "pit_in"]
    assert all(set(e["payload"]) <= {"car", "stop", "compound"} for e in pit_in)


def test_the_ai_leaves_the_human_cars_alone():
    room, _ = make_room(cars_controlled=2)
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    while room.race.session != "FINISHED":
        room.advance(1.0)
    assert room.race.cars["T0A"].stops == 0 and room.race.cars["T0B"].stops == 0


def test_one_controlled_car_leaves_the_team_mate_to_the_ai():
    room, _ = make_room(cars_controlled=1)
    assert room.human_cars == {"T0A"}
    assert room.team_cars("T0") == {"T0A"}


def test_radio_warns_the_human_team_about_tyres_and_nobody_else():
    room, b = make_room()
    for c in b["compounds"].values():
        c["wear_s_per_lap"] = 0.6
    room.race.bundle["compounds"] = b["compounds"]
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    events = []
    while room.race.session != "FINISHED":
        events += room.advance(1.0)
    assert [e for e in room.events_for("T0", events) if e["type"] == "radio"]
    assert not [e for e in room.events_for("T1", events) if e["type"] == "radio"]


def test_a_finished_room_writes_a_log_that_replays_to_the_same_digest(tmp_path):
    room, b = make_room(tmp_path)
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(40.0)
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))
    while room.race.session != "FINISHED":
        room.advance(1.0)
    assert (tmp_path / "r1.jsonl").exists()
    _, again = replay(b, room.log)
    assert again.digest() == room.log.digest()


def test_a_room_race_replays_exactly_through_the_runner_from_its_log(tmp_path):
    """The room has its own tick loop; the debrief replays with Runner. They must produce the same race, bit for bit."""
    from engine.runner import Runner
    room, b = make_room(tmp_path, cars_controlled=2)
    room.handle("T0", msg(kind="SetStartTyres", car="T0A", compound="SOFT"))
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(30.0)
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))
    room.advance(20.0)
    room.handle("T0", msg(kind="CallBox", car="T0B", compound="HARD"))
    room.handle("T0", msg(kind="CancelBox", car="T0B"))
    while room.race.session != "FINISHED":
        room.advance(1.0)
    runner = Runner.from_log(b, room.log)
    runner.run_to_end()
    assert [e for e in runner.race.events] == room.race.events
    assert runner.race.events[-1]["payload"]["order"] == room.race.events[-1]["payload"]["order"]
    assert room.log.header["human_team"] == "T0" and room.log.header["human_cars"] == ["T0A", "T0B"]
    assert len(room.log.header["bundle_sha"]) == 16


def test_a_swap_ordered_through_the_room_is_acknowledged_to_the_team_and_replays_exactly(tmp_path):
    from engine.runner import Runner
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 8
    for t in b["teams"][2:]:
        t["pace_delta_s"] += 30.0
    room = Room("sw", b, {"seed": 3, "circuit": "Test"}, human_team="T0", log_dir=tmp_path)
    with pytest.raises(ProtocolError, match="not your other car"):
        room.handle("T0", msg(kind="SwapPositions", car="T0A", with_car="T1A"))
    with pytest.raises(ProtocolError, match="only start tyres"):
        room.handle("T0", msg(kind="SwapPositions", car="T0A", with_car="T0B"))      # not before the lights go out
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(40.0)
    room.handle("T0", msg(kind="SwapPositions", car="T0A", with_car="T0B", anchor="before", turn=3))
    events = []
    while room.race.session != "FINISHED":
        events += room.advance(1.0)
    mine, theirs = room.events_for("T0", events), room.events_for("T5", events)
    assert any(e["type"] == "swap_ack" for e in mine) and not any(e["type"].startswith("swap_") for e in theirs)
    runner = Runner.from_log(b, room.log)
    runner.run_to_end()
    assert runner.race.events == room.race.events


def test_every_cars_lap_times_are_kept_for_the_snapshot_and_flagged_for_stops_and_safety_cars():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    while room.race.session != "FINISHED":
        room.advance(60)
    table = room.lap_table()
    assert set(table) == set(room.race.cars)
    rows = table["T0A"]
    assert [r[0] for r in rows] == list(range(1, 7)) and all(len(r) == 5 and r[1] > 0 for r in rows)
    assert any("P" in r[4] for r in rows)                        # the stop shows as a flagged, slow lap
    stop = next(r for r in rows if "P" in r[4])
    assert stop[1] > min(r[1] for r in rows) + 5


def test_the_team_sees_its_own_dirty_air_and_damage_but_not_the_others():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    room.advance(120)
    view = room.view("T0")
    assert set(view["own"]) == {"T0A", "T0B"}
    for own in view["own"].values():
        assert own["dirty_air_loss_s"] >= 0 and own["damage_loss_s"] >= 0
    assert room.info()["pit_loss_s"] > 0


def test_live_lap_events_carry_the_flags_of_the_lap_table_and_info_names_the_fuel_burn():
    room, b = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    events = []
    while room.race.session != "FINISHED":
        events += room.events_for("T0", room.advance(5.0))
    laps = [e["payload"] for e in events if e["type"] == "lap"]
    assert laps and all("flags" in p for p in laps)
    table = {(c, r[0]): r[4] for c, rows in room.lap_table().items() for r in rows}
    assert all(table[(p["car"], p["lap"])] == p["flags"] for p in laps)
    assert room.info()["fuel_s_per_lap"] == pytest.approx(b["fuel_s_per_lap"], abs=1e-5)


def test_a_stop_whose_pit_lane_crosses_the_line_is_flagged_on_one_lap_only():
    b = make_bundle()
    b["circuits"]["Test"].update(pit_entry_frac=0.9, pit_lane_frac=0.3, total_laps=8)      # the lane runs over the start line
    room = Room("r2", b, {"seed": 3, "circuit": "Test"}, human_team="T0")
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(1.0)
    room.handle("T0", msg(kind="CallBox", car="T0A", compound="HARD"))
    for _ in range(400):
        room.advance(1.0)
        if room.race.session == "FINISHED":
            break
    car = room.race.cars["T0A"]
    assert car.stops == 1
    assert sum("P" in row[4] for row in room.lap_table()["T0A"]) == 1


def test_the_info_names_the_lap_fraction_after_which_a_pit_call_is_for_the_next_lap():
    room, _ = make_room()
    c = room.race.circuit
    assert room.info()["pit_call_deadline_frac"] == pytest.approx(c["pit_entry_frac"] - c["pit_call_cutoff_frac"], abs=1e-3)


def test_the_info_carries_the_full_distance_next_to_the_race_length():
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 12
    room = Room("r3", b, {"seed": 3, "circuit": "Test", "laps": 5}, human_team="T0")
    assert (room.info()["total_laps"], room.info()["full_laps"]) == (5, 12)
    assert room.info()["swap_window_s"] == b["team_orders"]["window_s"]


def test_the_gap_to_the_leader_grows_down_the_order_and_the_interval_is_the_step_between_rows():
    room, _ = make_room()
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    checked = 0
    for _ in range(300):
        room.advance(2.0)
        rows = room.view("T0")["cars"]
        for a, c in zip(rows, rows[1:]):
            if c["status"] == "RUNNING" and a["status"] == "RUNNING" and None not in (c["interval_s"], c["gap_to_leader_s"], a["gap_to_leader_s"]):
                assert c["gap_to_leader_s"] >= a["gap_to_leader_s"] - 1e-9
                assert c["gap_to_leader_s"] - a["gap_to_leader_s"] == pytest.approx(c["interval_s"], abs=0.002)
                checked += 1
    assert checked > 100
