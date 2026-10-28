import copy
import math
import pickle

import pytest

from engine.actions import CallBox
from engine.eventlog import EventLog
from engine.race import bundle_sha
from engine.runner import Runner
from scoring.debrief import DebriefError, check_log, evaluate, format_report, human_decisions, run_debrief
from server.room import Room
from tests.helpers import make_bundle


def sc_world(wear, pit_ratio, laps, at_lap, stops=None, two_compounds=False):
    """Human team T0 (the fastest) on worn tyres, a safety car just out. Returns the runner at that moment."""
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    for c in b["compounds"].values():
        c["wear_s_per_lap"] = wear
    b["safety"].update(sc_pit_ratio=pit_ratio, vsc_pit_ratio=pit_ratio)
    b["pit_stop"].update(stationary_sd_s=0.0, slow_stop_prob=0.0, error_prob=0.0)
    b["weekend_pace"] = {"team_sd_s": 0.3, "driver_sd_s": 0.1}
    if stops:
        b["circuits"]["Test"]["stops_distribution"] = stops
    r = Runner(b, {"seed": 4, "circuit": "Test"}, human_team="T0", human_cars=("T0A", "T0B"))
    while min(c.lap for c in r.race.cars.values() if c.status == "RUNNING") < at_lap:
        r.step()
    if two_compounds:                                   # the rule is already met, so a stop is only a cost
        for c in ("T0A", "T0B"):
            r.race.cars[c].compound, r.race.cars[c].compounds_used, r.race.cars[c].stops = "HARD", ["MEDIUM", "HARD"], 1
    r.race.session, r.race.safety = "SC", {"kind": "SC", "start": r.race.cars[r.race.order()[0]].progress, "duration": 1.5}
    return r


def arms_for(r, comp="HARD"):
    blob = pickle.dumps(r.copy())
    return {"stay out": (blob, []), "box": (blob, [CallBox("T0A", comp), CallBox("T0B", comp)])}


def test_identical_alternatives_differ_by_exactly_zero():
    r = sc_world(0.05, 0.45, 12, 3)
    blob = pickle.dumps(r.copy())
    res = evaluate({"a": (blob, []), "b": (blob, [])}, 6, 4, ["T0A", "T0B"])
    assert res["b"]["delta_points"] == 0 and res["b"]["delta_points_se"] == 0
    assert res["b"]["delta_position"] == 0 and res["a"]["points"] == res["b"]["points"]


def test_known_answer_boxing_under_the_safety_car_wins_when_tyres_are_dying_and_the_stop_is_cheap(monkeypatch):
    # a neutral continuation: the AI makes its one planned stop on schedule and takes no reactive or free stops, so the only
    # difference between the alternatives is a cheap stop now against a full-price one later
    from engine.rivals import defaults as D
    monkeypatch.setattr(D, "TYRE_LOSS_PIT_S", 99.0)
    monkeypatch.setattr(D, "SAFETY_PIT_SHARE", 9.0)
    r = sc_world(wear=0.35, pit_ratio=0.15, laps=24, at_lap=9, stops={"1": 1})
    res = evaluate(arms_for(r), 16, 4, ["T0A", "T0B"])
    box = res["box"]
    # a position gain (negative delta) of more than two standard errors
    assert box["delta_position"] + 2 * box["delta_position_se"] < 0, box


def test_known_answer_boxing_loses_when_the_stop_is_dear_and_the_end_is_near():
    r = sc_world(wear=0.01, pit_ratio=1.0, laps=14, at_lap=10, stops={"1": 1}, two_compounds=True)
    res = evaluate(arms_for(r), 16, 4, ["T0A", "T0B"])
    box = res["box"]
    assert box["delta_position"] - 2 * box["delta_position_se"] > 0, box


def finished_room(tmp_path, calls=True):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 8
    room = Room("d1", b, {"seed": 3, "circuit": "Test"}, human_team="T0", log_dir=tmp_path)
    room.handle("T0", {"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "SOFT"})
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(20.0)
    if calls:
        room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    while room.race.session != "FINISHED":
        room.advance(1.0)
    return room, b


def test_the_debrief_refuses_a_race_that_is_not_finished_or_run_with_another_bundle(tmp_path):
    room, b = finished_room(tmp_path)
    unfinished = EventLog(room.log.header)
    unfinished.extend([e for e in room.log.events if e["type"] != "classification"])
    with pytest.raises(DebriefError, match="not finished"):
        check_log(b, unfinished)
    other = copy.deepcopy(b)
    other["fuel_s_per_lap"] += 0.01
    with pytest.raises(DebriefError, match="different parameter bundle"):
        check_log(other, room.log)
    nobody = EventLog({**room.log.header, "human_team": None})
    nobody.extend(room.log.events)
    with pytest.raises(DebriefError, match="no human team"):
        check_log(b, nobody)


def test_decisions_are_the_start_tyres_the_acknowledged_calls_and_nothing_else(tmp_path):
    room, _ = finished_room(tmp_path)
    ds = human_decisions(room.log)
    assert [(d["kind"], d["car"]) for d in ds if d["kind"] != "safety"] == [("start", "T0A"), ("start", "T0B"), ("call", "T0A")]
    assert [d for d in ds if d["kind"] == "call"][0]["taken"] == [("CallBox", "HARD", None)]


def test_a_replay_that_does_not_reproduce_the_race_is_refused(tmp_path):
    room, b = finished_room(tmp_path)
    tampered = copy.deepcopy(b)
    tampered["lap_noise_s"] = b["lap_noise_s"] + 0.1
    log = EventLog({**room.log.header, "bundle_sha": bundle_sha(tampered)})
    log.extend(room.log.events)
    with pytest.raises(DebriefError, match="does not reproduce"):
        run_debrief(tampered, log, futures=2)


def test_each_alternative_of_a_call_decision_really_does_something_different(tmp_path):
    """Regression: the recorded call used to be applied in every alternative, so all of them gave identical results."""
    from scoring.debrief import _advance, decision_arms
    room, b = finished_room(tmp_path)
    call = next(d for d in human_decisions(room.log) if d["kind"] == "call")
    runner = Runner.from_log(b, room.log)
    _advance(runner, call["tick"])
    arms = decision_arms(b, room.log, runner, call)
    state = {}
    for oid, arm in arms.items():
        r = pickle.loads(arm.blob)
        r.reseed_future(1)                                   # stored branches carry no draws; every future brings its own
        r.step(arm.extra)
        state[oid] = r.race.cars[call["car"]].box_call
    assert state["taken"] == {"compound": "HARD", "effective_lap": state["taken"]["effective_lap"]}
    assert state["none"] is None
    assert state["box:MEDIUM"]["compound"] == "MEDIUM" and state["box:SOFT"]["compound"] == "SOFT"
    assert [a.name for a in arms.values()][:2] == ["Box hard", "Stay out"]          # what a player calls them, not CallBox HARD


def test_a_swap_call_is_a_decision_with_alternatives_in_the_debrief(tmp_path):
    from scoring.debrief import _advance, decision_arms
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 8
    for t in b["teams"][2:]:
        t["pace_delta_s"] += 30.0
    room = Room("sw", b, {"seed": 3, "circuit": "Test"}, human_team="T0", log_dir=tmp_path)
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(35.0)
    room.handle("T0", {"type": "action", "kind": "SwapPositions", "car": "T0A", "with_car": "T0B", "anchor": "before", "turn": 3})
    while room.race.session != "FINISHED":
        room.advance(1.0)
    swap = next(d for d in human_decisions(room.log) if d["kind"] == "swap")
    assert swap["car"] == "T0A" and swap["taken"]["anchor"] == "before"
    runner = Runner.from_log(b, room.log)
    _advance(runner, swap["tick"])
    arms = decision_arms(b, room.log, runner, swap)
    assert [a.name for a in arms.values()] == ["Swap before turn 3", "Don't swap", "Swap as soon as possible"]
    report = run_debrief(b, room.log, futures=2)
    assert any(d["kind"] == "swap" for d in report["decisions"])


def test_a_recorded_box_opposite_call_is_rebuilt_with_its_target_for_the_alternatives(monkeypatch):
    from engine.actions import BoxOpposite
    from scoring.debrief import decision_arms

    ev = [{"tick": 0, "type": "lights_out", "payload": {"start_tyres": {"T0A": "MEDIUM"}}},
          {"tick": 5, "type": "action", "payload": {"kind": "BoxOpposite", "car": "T0A", "compound": "HARD", "target": "T1A"}},
          {"tick": 5, "type": "box_ack", "payload": {"car": "T0A", "ok": True}}]
    log = type("L", (), {"events": ev, "header": {"human_cars": ["T0A"]}})()
    call = next(d for d in human_decisions(log) if d["kind"] == "call")
    runner = type("R", (), {"human_actions": {}, "race": type("Ra", (), {"tick": 5, "weather": None, "cars": {"T0A": type("C", (), {"sets": {}})()}})(),
                            "copy": lambda self: self})()
    runner.copy = lambda: type("B", (), {"human_actions": {}})()
    monkeypatch.setattr("scoring.debrief._dump", lambda b: b)
    arms = decision_arms({}, log, runner, call)
    assert arms["taken"].extra == [BoxOpposite("T0A", "T1A", "HARD")]
    assert arms["taken"].name == "Box opposite T1A, hard"                 # no driver to look up: the id stands in


def test_a_box_opposite_call_is_named_with_the_rivals_surname():
    from engine.actions import BoxOpposite
    from scoring.debrief import action_name
    assert action_name(BoxOpposite("T0A", "BRA", "HARD"), lambda c: {"BRA": "Brackett"}[c]) == "Box opposite Brackett, hard"


# -- the numbers of a debrief add up, whatever the race ------------------------------------------------------------------------

def _play_out(room):
    while room.race.session != "FINISHED":
        room.advance(1.0)
    return room


def race_with_calls():
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 8
    room = Room("d1", b, {"seed": 3, "circuit": "Test"}, human_team="T0")
    room.handle("T0", {"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "SOFT"})
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.advance(20.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    room.advance(10.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0B", "compound": "SOFT"})
    return _play_out(room), b


def race_with_box_opposite():
    from tests.test_orders import rival_ahead, started
    room, b = started(laps=10)
    room.handle("T0", {"type": "action", "kind": "BoxOpposite", "car": "T0A", "target": rival_ahead(room), "compound": "HARD"})
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0B", "compound": "SOFT"})
    return _play_out(room), b


def race_with_a_late_call():
    """T0A's stop is called after the cutoff of its lap, so the engine pushes it to the next lap."""
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 9
    room = Room("d3", b, {"seed": 5, "circuit": "Test"}, human_team="T0")
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    circ = room.race.circuit
    cutoff = circ["pit_entry_frac"] - circ["pit_call_cutoff_frac"]
    while True:
        room.advance(0.5)
        c = room.race.cars["T0A"]
        if c.lap >= 2 and c.progress - int(c.progress) > cutoff + 0.02:
            break
    events = []
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    events += room.advance(0.2)
    acks = [e["payload"]["message"] for e in events if e["type"] == "box_ack" and e["payload"]["car"] == "T0A"]
    assert acks and "Too late, box next lap" in acks[0]                   # the scenario is the one meant
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0B", "compound": "SOFT"})
    return _play_out(room), b


RACES = {"two calls": race_with_calls, "box opposite": race_with_box_opposite, "late call": race_with_a_late_call}


@pytest.fixture(scope="module", params=list(RACES))
def debriefed(request):
    room, b = RACES[request.param]()
    return run_debrief(b, room.log, futures=4), room, b


def test_the_contributions_add_up_to_skill_and_baseline_skill_and_luck_add_up_to_the_score(debriefed):
    report = debriefed[0]
    s = report["summary"]
    assert sum(d["contribution_points"] for d in report["decisions"]) == pytest.approx(s["skill_points"], abs=1e-9)
    assert sum(d["contribution_places"] for d in report["decisions"]) == pytest.approx(s["skill_places"], abs=1e-9)
    assert s["baseline_points"] + s["skill_points"] + s["luck_points"] == pytest.approx(s["actual_points"], abs=1e-9)
    assert s["expected_points"] == pytest.approx(s["baseline_points"] + s["skill_points"], abs=1e-9)


def test_the_value_after_each_decision_is_its_taken_option_and_the_last_is_expected_from_your_calls(debriefed):
    report = debriefed[0]
    s, ds = report["summary"], report["decisions"]
    running = s["baseline_points"]
    for d in ds:
        running += d["contribution_points"]
        taken = next(o for o in d["options"] if o["taken"])
        assert taken["points"] == pytest.approx(running, abs=1e-9)
        assert d["value_after"] == pytest.approx(running, abs=1e-9)
    assert ds[-1]["options"][0]["points"] == pytest.approx(s["expected_points"], abs=1e-9)


def test_the_default_start_option_of_the_first_decision_is_the_baseline(debriefed):
    report = debriefed[0]
    first = report["decisions"][0]
    assert first["kind"] == "start"
    default = [o for o in first["options"] if o["default"]]
    assert len(default) == 1
    assert default[0]["points"] == pytest.approx(report["summary"]["baseline_points"], abs=1e-9)


def test_the_taken_option_differs_from_itself_by_exactly_nothing_and_is_shown_without_a_signed_zero(debriefed):
    report = debriefed[0]
    for d in report["decisions"]:
        taken = d["options"][0]
        assert taken["taken"] and taken["verdict"] == "taken"
        assert taken["delta_points"] == 0.0 and taken["delta_points_se"] == 0.0 and taken["places"] == 0.0
        assert math.copysign(1.0, taken["delta_points"]) == 1.0 and math.copysign(1.0, taken["places"]) == 1.0
    for line in format_report(report).splitlines():
        if line.startswith(" *"):
            assert "-0.0" not in line and "+/- 0.0" not in line and line.rstrip().endswith("taken")


def test_a_miss_is_the_best_options_paired_advantage_and_is_never_negative(debriefed):
    for d in debriefed[0]["decisions"]:
        best = next(o for o in d["options"] if o["id"] == d["best"])
        assert d["miss_points"] == pytest.approx(max(best["delta_points"], 0.0))
        assert d["miss_points"] >= 0 and d["miss_places"] >= 0
        assert d["significant"] == (best["verdict"] == "better")
        for o in d["options"]:
            if o["verdict"] == "better":
                assert o["delta_points"] > 2 * o["delta_points_se"] or o["delta_points"] == o["delta_points_se"] == 0


def test_every_decision_is_named_for_a_player_and_the_scenarios_are_the_ones_meant(debriefed):
    report, room, _ = debriefed
    names = {o["name"] for d in report["decisions"] for o in d["options"]}
    assert not any(n.startswith(("CallBox", "BoxOpposite", "start on")) for n in names)
    kinds = {e["payload"]["kind"] for e in room.log.events if e["type"] == "action"}
    assert any(d["call"].startswith("Box") for d in report["decisions"] if d["kind"] == "call")
    assert kinds & {"CallBox", "BoxOpposite"}


def test_the_races_include_a_box_opposite_order_and_a_late_call():
    room, _ = race_with_box_opposite()
    assert any(e["type"] == "action" and e["payload"]["kind"] == "BoxOpposite" for e in room.log.events)
    room, _ = race_with_a_late_call()
    assert any(e["type"] == "box_ack" and "Too late" in e["payload"].get("message", "") for e in room.log.events)


def test_wet_tyres_are_offered_only_when_rain_is_relevant(monkeypatch):
    from types import SimpleNamespace
    import scoring.debrief as dbg
    dry = {"raining": False, "track": "dry", "wet_race_declared": False, "forecast_next_laps": [0.1, 0.39]}
    for wx, expect in [(None, False), (dry, False), ({**dry, "forecast_next_laps": [0.1, 0.4]}, True), ({**dry, "raining": True}, True),
                       ({**dry, "track": "damp"}, True), ({**dry, "wet_race_declared": True}, True)]:
        monkeypatch.setattr(dbg.weather, "visible", lambda race, wx=wx: wx)
        assert dbg.rain_relevant(SimpleNamespace()) is expect


def test_the_default_strategy_that_takes_over_counts_a_stop_already_called_instead_of_planning_another():
    """Regression: the hand-over planned from the public row, which does not know a called stop, so every alternative that boxed
    was followed by an extra stop and every value after a call came out too low."""
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 12
    r = Runner(b, {"seed": 4, "circuit": "Test"}, human_team="T0", human_cars=("T0A", "T0B"), start_tyres={"T0A": "MEDIUM", "T0B": "MEDIUM"})
    for _ in range(40):
        r.step()
    r.step([CallBox("T0A", "HARD")])
    assert r.race.cars["T0A"].box_call is not None
    r.hand_to_ai()
    plan = r.policies["T0"].plans["T0A"]
    assert plan[r.race.cars["T0A"].stops + 1][0] == "HARD"            # the called stop is the first of the plan
    assert plan[r.race.cars["T0A"].stops][0] is None                   # the entries before it are placeholders, as for a car that stopped before
    other = r.policies["T0"].plans["T0B"]
    assert other[r.race.cars["T0B"].stops][0] == "MEDIUM"             # a car with nothing called is planned from where it is


# -- a multiplayer race: each player is judged on their own calls -----------------------------------------------------------

def multiplayer_race():
    """Two players, each with a call, and the second one's seat on the autopilot for a stretch."""
    from server.room import AWAY_S
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 10
    room = Room("m1", b, {"seed": 5, "circuit": "Test"}, human_team="T0", multiplayer=True)
    room.claim("T1", "Sam")
    room.handle("T0", {"type": "action", "kind": "SetStartTyres", "car": "T0A", "compound": "SOFT"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.handle("T0", {"type": "control", "op": "start"})
    room.set_connected("T0", True)
    room.set_connected("T1", True)
    room.advance(15.0)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    room.advance(6.0)
    room.handle("T1", {"type": "action", "kind": "CallBox", "car": "T1B", "compound": "SOFT"})
    room.advance(4.0)
    room.set_connected("T1", False)
    room.advance(AWAY_S + 1.0)
    room.set_connected("T1", True)
    return _play_out(room), b


def test_every_human_team_gets_a_debrief_judged_on_its_own_calls_and_a_score_out_of_100():
    from scoring.debrief import run_debrief_all
    room, b = multiplayer_race()
    reports = run_debrief_all(b, room.log, futures=3)
    assert set(reports) == {"T0", "T1"}
    for team, r in reports.items():
        s = r["summary"]
        assert r["cars"] == [c for c in ("T0A", "T0B", "T1A", "T1B") if c.startswith(team)]
        assert {d["car"] for d in r["decisions"]} <= set(r["cars"])                   # nobody is credited with another player's call
        assert 0 <= s["score_low"] <= s["score"] <= s["score_high"] <= 100
        assert abs(s["skill_points"] - sum(d["contribution_points"] for d in r["decisions"])) < 1e-9
        assert abs(s["expected_points"] - (s["baseline_points"] + s["skill_points"])) < 1e-9
        assert abs(s["actual_points"] - (s["expected_points"] + s["luck_points"])) < 1e-9
    assert any(d["kind"] == "call" for d in reports["T0"]["decisions"]) and any(d["kind"] == "call" for d in reports["T1"]["decisions"])


def test_the_ai_stretch_of_a_seat_is_not_a_decision_of_its_player():
    from scoring.debrief import human_decisions
    from engine.runner import car_teams
    room, b = multiplayer_race()
    mine = human_decisions(room.log, ["T1A", "T1B"], car_teams(b))
    calls = [d for d in mine if d["kind"] == "call"]
    assert [(d["car"], d["taken"][0][1]) for d in calls] == [("T1B", "SOFT")]           # the AI's own stop while the seat was away is not listed


def test_the_strategist_score_is_50_for_the_ais_own_result_and_rises_and_falls_smoothly():
    from scoring.debrief import strategist_score
    assert strategist_score(0, 0)[0] == 50
    assert 85 < strategist_score(3, 0)[0] < 95 and 5 < strategist_score(-3, 0)[0] < 15
    assert strategist_score(1, 0)[0] < strategist_score(2, 0)[0] < strategist_score(3, 0)[0] < 100
    assert abs(strategist_score(2, 3)[0] + strategist_score(-2, -3)[0] - 100) < 1e-9          # symmetric around 50
    mid, lo, hi = strategist_score(1, 1, 1.0, 1.0)                                              # (score, low, high)
    assert lo < mid < hi


def test_a_stop_rule_penalty_counts_against_the_strategist_score():
    """Not stopping is no call, so the debrief's decisions never see it; the penalty is added to the score as the places it cost."""
    from scoring.debrief import unpenalised_order
    events = [{"tick": 1, "type": "finish", "payload": {"car": c, "laps": 5, "time": t}} for c, t in (("A", 10.0), ("B", 11.0), ("C", 12.0))]
    assert unpenalised_order(events, ["B", "C", "A"]) == ["A", "B", "C"]                               # A was penalised: classified last
    assert unpenalised_order(events + [{"tick": 2, "type": "finish", "payload": {"car": "D", "laps": 4, "time": 9.0}}], ["B", "C", "D", "A"]) == ["A", "B", "C", "D"]
    room, b = finished_room_without_stops()
    s = run_debrief(b, room.log, futures=2)["summary"]
    assert s["penalty_places"] > 0 and s["penalty_points"] >= 0
    from scoring.debrief import strategist_score
    assert s["score"] < strategist_score(s["skill_places"], s["skill_points"])[0]


def finished_room_without_stops():
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 6
    room = Room("p1", b, {"seed": 4, "circuit": "Test"}, human_team="T0")
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    room.handle("T0", {"type": "control", "op": "start"})
    return _play_out(room), b
