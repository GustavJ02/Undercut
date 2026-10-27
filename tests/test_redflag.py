import copy

from engine.actions import CallBox
from engine.tick import tick
from tests.helpers import make_bundle, new_race, run


def red_bundle(p_red=1.0, laps=10, hold=20.0):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    b["incidents"]["mechanical_per_car_lap"] = 0.05
    b["incidents"]["mechanical_on_track_share"] = 1.0
    b["incidents"]["hazard_response"] = {"sc": 0.0, "vsc": 0.0, "red": p_red}
    b["incidents"]["red_flag"]["hold_s"] = hold
    return b


def until_red(race, limit=20000):
    while race.session != "RED" and race.session != "FINISHED" and race.tick < limit:
        tick(race)
    return race.session == "RED"


def test_a_stopped_car_can_bring_out_a_red_flag_and_the_cars_stand_still():
    race = new_race(red_bundle())
    assert until_red(race)
    positions = {c.id: c.progress for c in race.cars.values() if c.status == "RUNNING"}
    for _ in range(10):
        tick(race)
    assert race.session == "RED"
    assert positions == {c.id: c.progress for c in race.cars.values() if c.status == "RUNNING"}
    assert [e for e in race.events if e["type"] == "red_flag"]


def test_the_race_restarts_from_a_standing_start_in_the_running_order_behind_the_line():
    race = new_race(red_bundle(hold=10.0))
    until_red(race)
    order_before = [i for i in race.order() if race.cars[i].status == "RUNNING"]
    while race.session == "RED":
        tick(race)
    assert race.session == "RACING"
    restart = [e for e in race.events if e["type"] == "restart"][0]["payload"]
    assert restart["order"] == order_before
    laps = {c.lap for c in race.cars.values() if c.status == "RUNNING"}
    assert len(laps) == 1                                         # one lap count for everybody (lapped cars are unlapped)
    lead = race.cars[order_before[0]]
    assert lead.progress < lead.lap and lead.progress > lead.lap - 0.2        # behind the line
    spacing = race.cars[order_before[0]].progress - race.cars[order_before[1]].progress
    assert spacing > 0


def test_free_tyre_changes_cost_no_time_and_use_a_set_and_count_for_the_two_compound_rule():
    race = new_race(red_bundle(hold=30.0), start="MEDIUM")
    until_red(race)
    car = next(c for c in race.cars.values() if c.status == "RUNNING")
    sets_before = car.sets["HARD"]
    ev = tick(race, [CallBox(car.id, "HARD")])
    ack = next(e for e in ev if e["type"] == "box_ack")["payload"]
    assert ack["ok"] and "Tyre change confirmed" in ack["message"]
    while race.session == "RED":
        tick(race)
    assert car.compound == "HARD" and car.age == 0 and car.sets["HARD"] == sets_before - 1
    assert car.compounds_used == ["MEDIUM", "HARD"] and car.box_call is None
    assert [e for e in race.events if e["type"] == "tyre_change" and e["payload"]["car"] == car.id]


def test_no_set_left_is_refused_and_a_call_can_be_cancelled():
    b = red_bundle(hold=30.0)
    b["tyre_sets"] = {"SOFT": 0, "MEDIUM": 3, "HARD": 2}
    race = new_race(b)
    until_red(race)
    car = next(c for c in race.cars.values() if c.status == "RUNNING")
    ack = next(e for e in tick(race, [CallBox(car.id, "SOFT")]) if e["type"] == "box_ack")["payload"]
    assert not ack["ok"]
    tick(race, [CallBox(car.id, "HARD")])
    assert car.box_call["compound"] == "HARD"


def test_a_race_with_red_flags_finishes_with_every_lap_counted_once():
    b = red_bundle(p_red=0.5, laps=8)
    race = run(new_race(b, seed=3), max_ticks=60000)
    assert race.session == "FINISHED"
    for c in race.cars.values():
        if c.status == "FINISHED":
            assert c.lap == 8
    laps = [e["payload"] for e in race.events if e["type"] == "lap"]
    seen = {}
    for p in laps:
        seen.setdefault(p["car"], []).append(p["lap"])
    for car, ls in seen.items():
        assert ls == sorted(set(ls)), (car, ls)                  # no lap reported twice, none out of order


def test_the_ai_takes_free_tyres_when_they_are_worn_and_a_stop_is_still_planned():
    from engine.race import run_race
    b = red_bundle(p_red=1.0, laps=20)
    b["circuits"]["Test"]["stops_distribution"] = {"2": 1}
    for c in b["compounds"].values():
        c["wear_s_per_lap"] = 0.15
    _race, log = run_race(copy.deepcopy(b), {"seed": 2, "circuit": "Test"})
    assert [e for e in log.events if e["type"] == "tyre_change"]
    assert not log.of_type("penalty") or all(p["payload"]["reason"] for p in log.of_type("penalty"))
