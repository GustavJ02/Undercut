from engine.tick import tick
from tests.helpers import make_bundle, new_race


def sc_bundle(kind="SC"):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 12
    b["safety"].update(early_boost=1.0)
    b["circuits"]["Test"].update(residual_sc_rate_per_lap=2.0 if kind == "SC" else 0.0,
                                 residual_vsc_rate_per_lap=2.0 if kind == "VSC" else 0.0)
    return b


def run_until_ended(race):
    while race.session != "FINISHED":
        tick(race)
    return race.events


def between(events, start_type, end_type):
    inside, out = False, []
    for e in events:
        if e["type"] == start_type:
            inside = True
        elif e["type"] == end_type:
            inside = False
        elif inside:
            out.append(e)
    return out


def test_safety_car_bunches_the_field_and_blocks_passing():
    race = new_race(sc_bundle("SC"))
    while race.session != "SC":
        tick(race)
    for _ in range(int(2 * 90 / race.dt)):               # two laps under the safety car
        if race.session != "SC":
            break
        tick(race)
    running = sorted((c for c in race.cars.values() if c.status == "RUNNING"), key=lambda c: -c.progress)
    gaps = [(a.progress - b.progress) * b.lt * race.bundle["safety"]["sc_lap_factor"] for a, b in zip(running, running[1:])]
    assert max(gaps) < 3 * race.bundle["safety"]["sc_gap_s"]
    events = run_until_ended(race)
    assert not [e for e in between(events, "safety_deployed", "safety_ended") if e["type"] == "pass"]
    assert [e for e in events if e["type"] == "safety_ended"]


def test_vsc_slows_every_car_by_the_factor_and_blocks_passing():
    race = new_race(sc_bundle("VSC"))
    while race.session != "VSC":
        tick(race)
    leader = race.cars[race.order()[0]]
    p0 = leader.progress
    for _ in range(20):
        tick(race)
    speed = (leader.progress - p0) / (20 * race.dt)
    assert speed * leader.lt == __import__("pytest").approx(1 / race.bundle["safety"]["vsc_lap_factor"], rel=0.03)
    events = run_until_ended(race)
    assert not [e for e in between(events, "safety_deployed", "safety_ended") if e["type"] == "pass"]


def test_pit_stop_under_the_safety_car_costs_less():
    from engine.actions import CallBox
    from tests.helpers import run
    from tests.test_pit import clean_air_bundle
    b = clean_air_bundle(laps=6)
    green = new_race(b)
    run(green, {2: [CallBox(green.grid[0], "HARD")]})
    green_in = [e for e in green.events if e["type"] == "pit_in"][0]["payload"]["duration"]
    sc = new_race(b)
    sc.session, sc.safety = "SC", {"kind": "SC", "start": 0.0, "duration": 50.0}
    run(sc, {2: [CallBox(sc.grid[0], "HARD")]})
    sc_in = [e for e in sc.events if e["type"] == "pit_in"][0]["payload"]
    assert sc_in["session"] == "SC" and sc_in["duration"] < green_in


def test_race_control_announces_the_end_of_each_safety_period_at_most_once_and_before_it_happens():
    from server.visibility import filter_event
    for kind in ("SC", "VSC"):
        events = run_until_ended(new_race(sc_bundle(kind)))
        warned, open_period = 0, False
        for e in events:
            if e["type"] == "safety_deployed":
                open_period, warned = True, 0
            elif e["type"] == "safety_ending":
                assert open_period and e["payload"]["kind"] == kind
                warned += 1
                assert warned == 1
                assert filter_event(e, set())["payload"] == {"kind": kind}
            elif e["type"] == "safety_ended":
                open_period = False
        assert any(e["type"] == "safety_ending" for e in events)


def _watch(race):
    """Run the race and note the safety car's phases and what happened at the green flag."""
    phases, seen, green = [], 0, []
    while race.session != "FINISHED":
        tick(race)
        if race.session == "SC" and race.safety is not None:
            ph = race.safety.get("phase")
            if not phases or phases[-1] != ph:
                phases.append(ph)
        for e in race.events[seen:]:
            if e["type"] == "safety_ended" and e["payload"]["kind"] == "SC":
                green.append((e["tick"], race.green_line, max(c.progress for c in race.cars.values() if c.status != "RETIRED")))
            if e["type"] == "pass" and green:
                car = race.cars[e["payload"]["car"]]
                assert car.p0 >= race.green_line - 1e-9, "a car overtook before crossing the green flag line"
        seen = len(race.events)
    return phases, green


def test_the_safety_car_leaves_the_pit_exit_and_goes_in_at_the_pit_entry_and_green_comes_at_the_line():
    race = new_race(sc_bundle("SC"))
    phases, green = _watch(race)
    assert phases[:4] == ["waiting", "track", "in", "gone"]
    assert green
    for _, line, lead_progress in green:
        assert line == int(line) and line >= 1                       # the flag is shown at the start / finish line
        assert lead_progress >= line


def test_nobody_overtakes_between_the_safety_car_deployment_and_crossing_the_green_flag_line():
    race = new_race(sc_bundle("SC"))
    seen, deployed = 0, False
    while race.session != "FINISHED":
        tick(race)
        for e in race.events[seen:]:
            if e["type"] == "safety_deployed":
                deployed = True
            if e["type"] == "safety_ended":
                deployed = False
            assert not (deployed and e["type"] == "pass"), "a pass under the safety car"
        seen = len(race.events)


def test_the_safety_car_is_published_only_while_it_is_on_the_track():
    from server.visibility import project
    race = new_race(sc_bundle("SC"))
    on_track = False
    while race.session != "FINISHED":
        tick(race)
        v = project(race, "T0")
        phase = (race.safety or {}).get("phase") if race.session == "SC" else None
        if phase in ("track", "in"):
            assert v["safety_car"] is not None and 0 <= v["safety_car"]["lap_frac"] < 1
            on_track = True
        else:
            assert v["safety_car"] is None
    assert on_track


import pytest


@pytest.mark.parametrize("seed", range(1, 9))
def test_the_safety_car_goes_in_at_the_first_pit_entry_after_the_in_this_lap_notice(seed):
    """From the notice the leader travels at most a lap, and a little for the gap to the car, before the safety car is in."""
    race = new_race(sc_bundle("SC"), seed=seed)
    warned, seen, travelled = None, 0, []
    while race.session != "FINISHED":
        tick(race)
        lead = max(c.progress for c in race.cars.values() if c.status != "RETIRED")
        for e in race.events[seen:]:
            if e["type"] == "safety_ending" and e["payload"]["kind"] == "SC":
                warned = lead
        seen = len(race.events)
        if warned is not None and (race.session != "SC" or race.safety.get("phase") == "gone"):
            travelled.append(lead - warned)
            warned = None
    assert travelled
    assert all(t <= 1.15 for t in travelled), travelled
