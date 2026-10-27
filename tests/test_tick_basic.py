import pytest

from tests.helpers import make_bundle, new_race, run


def test_a_race_runs_to_the_end_and_everyone_finishes():
    race = run(new_race())
    assert race.session == "FINISHED"
    assert all(c.status == "FINISHED" for c in race.cars.values())
    assert all(c.lap == 10 for c in race.cars.values())


def test_lap_time_follows_the_lap_model_without_noise_or_traffic():
    b = make_bundle()
    b["teams"] = b["teams"][:1] + b["teams"][1:]          # ten teams; the leader runs in clean air
    b["teams"] = [dict(b["teams"][0], pace_delta_s=-5.0)] + b["teams"][1:]   # a clear leader, always in clean air
    race = run(new_race(b, laps=3))
    first = race.order()[0]
    laps = [e["payload"]["lap_time"] for e in race.events if e["type"] == "lap" and e["payload"]["car"] == first]
    comp = b["compounds"]["MEDIUM"]
    car = race.cars[first]
    # lap 2 lasts as long as the potential computed at lap 1 (age 1, one lap of fuel burned)
    expected = 90.0 + car.pace_s + comp["pace_offset_s"] + comp["wear_s_per_lap"] * 1 - b["fuel_s_per_lap"] * 1
    assert laps[1] == pytest.approx(expected, abs=0.05)


def test_cars_never_share_a_position_and_order_matches_progress():
    race = new_race()
    from engine.tick import tick
    while race.session != "FINISHED":
        tick(race)
        running = sorted((c for c in race.cars.values() if c.status == "RUNNING"), key=lambda c: -c.progress)
        gaps = [(a.progress - b.progress) * b.lt for a, b in zip(running, running[1:])]
        assert all(g >= race.bundle["traffic"]["min_gap_s"] * 0.98 for g in gaps), min(gaps)


def test_a_lapped_car_that_has_finished_does_not_rank_above_a_car_still_on_the_lead_lap():
    """Regression: after the leader took the flag, lapped cars crossing the line jumped above lead-lap cars on their last lap."""
    race = new_race(laps=5)
    a, b, c, d = (race.cars[i] for i in race.grid[:4])
    a.status, a.lap, a.progress, a.finish_t = "FINISHED", 5, 5.0, 400.0          # the leader has the flag
    b.status, b.lap, b.progress = "RUNNING", 4, 4.8                                # second, on its last lap
    c.status, c.lap, c.progress, c.finish_t = "FINISHED", 4, 4.0, 410.0           # lapped, already across the line
    d.status, d.lap, d.progress = "RUNNING", 4, 4.3                                # third on the road, still to finish
    for other in list(race.cars.values())[4:]:
        other.status, other.retired_t = "RETIRED", 0.0
    assert race.order() == [a.id, b.id, d.id, c.id, *sorted(o.id for o in list(race.cars.values())[4:])]


def test_the_published_order_after_the_flag_is_the_official_classification_with_penalties():
    """Regression: a car that broke the two-compound rule was shown second although the classification put it last."""
    race = run(new_race(laps=4))                     # everybody stays on one compound, so everybody is penalised
    cls = next(e for e in race.events if e["type"] == "classification")["payload"]["order"]
    assert race.order() == cls and race.final_order == cls


def test_finished_cars_show_real_flag_gaps_and_laps_down():
    from server.visibility import project
    b = make_bundle()
    b["teams"] = [dict(b["teams"][0], pace_delta_s=-8.0)] + b["teams"][1:3]
    race = run(new_race(b, laps=4, start="MEDIUM"))
    rows = {c["id"]: c for c in project(race, "T0")["cars"]}
    leader = project(race, "T0")["cars"][0]
    assert leader["gap_to_leader_s"] == 0.0
    for c in rows.values():
        if c["laps_down"] == 0 and c["position"] > 1 and c["status"] == "FINISHED":
            assert c["gap_to_leader_s"] > 0
        if c["laps_down"] > 0:
            assert c["gap_to_leader_s"] is None


def test_a_car_is_a_lap_down_only_once_the_leader_has_lapped_it_on_track():
    from types import SimpleNamespace as N
    from server.visibility import _laps_down
    leader = N(status="RUNNING", lap=5, progress=5.05)
    assert _laps_down(leader, N(status="RUNNING", lap=4, progress=4.98)) == 0      # leader crossed the line first
    assert _laps_down(leader, N(status="RUNNING", lap=4, progress=4.05)) == 1
    assert _laps_down(leader, N(status="RUNNING", lap=3, progress=3.9)) == 1
    assert _laps_down(leader, N(status="RETIRED", lap=2, progress=2.1)) == 0


def test_cars_on_the_grid_are_published_just_behind_the_line_in_grid_order():
    from server.visibility import _lap_frac, project
    race = new_race()
    rows = project(race, "T0")["cars"]
    fracs = [c["lap_frac"] for c in rows]
    assert all(0.0 <= f < 1.0 for f in fracs)
    assert all(f > 0.5 for f in fracs) and fracs == sorted(fracs, reverse=True)       # pole is closest to the line
    assert _lap_frac(-0.00001) == 0.0 and _lap_frac(0.25) == 0.25


def test_the_grid_positions_published_before_the_start_are_where_the_engine_puts_the_cars():
    from server.visibility import project
    from engine.setup import start_race
    race = new_race()
    before = {c["id"]: c["lap_frac"] for c in project(race, "T0")["cars"]}
    start_race(race, {cid: "MEDIUM" for cid in race.grid})
    after = {c["id"]: c["lap_frac"] for c in project(race, "T0")["cars"]}
    assert before.keys() == after.keys()
    assert all(abs(before[k] - after[k]) < 2e-4 for k in before)
