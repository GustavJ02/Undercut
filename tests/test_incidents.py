import copy
import statistics as st

import pytest

from engine.actions import CallBox
from engine.race import run_race
from tests.helpers import make_bundle, new_race, run


def incident_bundle(mech=0.0, on_track=0.0, contact=0.0, sc=0.5, vsc=0.3, outcome=None, laps=12):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    inc = b["incidents"]
    inc["mechanical_per_car_lap"], inc["mechanical_on_track_share"] = mech, on_track
    inc["collision"].update(rate_per_exposure_s=contact, window_s=1.0, outcome=outcome or {"damage": 0.25, "retire": 0.15})
    inc["hazard_response"] = {"sc": sc, "vsc": vsc, "red": 0.0}
    return b


def kinds(events, type_):
    return [e["payload"] for e in events if e["type"] == type_]


def test_no_incidents_when_every_rate_is_zero():
    race = run(new_race(incident_bundle()))
    assert not kinds(race.events, "retirement") and not kinds(race.events, "contact")


def test_a_mechanical_failure_retires_the_car_and_the_race_still_ends():
    race = run(new_race(incident_bundle(mech=0.08)))
    out = kinds(race.events, "retirement")
    assert out and all(p["cause"] == "mechanical" for p in out)
    retired = {c.id for c in race.cars.values() if c.status == "RETIRED"}
    assert retired == {p["car"] for p in out}
    order = race.events[-1]["payload"]["order"]
    assert order[-len(retired):] and set(order[-len(retired):]) == retired
    assert not [p for p in kinds(race.events, "penalty") if p["car"] in retired]
    assert race.order()[-len(retired):] == order[-len(retired):] or set(race.order()[-len(retired):]) == retired


def test_a_car_stopped_on_track_can_bring_out_the_safety_car():
    race = run(new_race(incident_bundle(mech=0.08, on_track=1.0, sc=1.0, vsc=0.0)))
    dep = kinds(race.events, "safety_deployed")
    assert dep and dep[0]["kind"] == "SC" and "stopped on track" in dep[0]["cause"]


def test_a_failure_in_the_pits_or_a_local_yellow_does_not_stop_the_race():
    pit = run(new_race(incident_bundle(mech=0.08, on_track=0.0)))
    assert kinds(pit.events, "retirement") and not kinds(pit.events, "safety_deployed")
    yellow = run(new_race(incident_bundle(mech=0.08, on_track=1.0, sc=0.0, vsc=0.0)))
    assert kinds(yellow.events, "local_yellow") and not kinds(yellow.events, "safety_deployed")


def test_contact_needs_a_car_within_the_window_and_can_damage_or_retire_the_cars_involved():
    race = run(new_race(incident_bundle(contact=0.5, outcome={"damage": 0.5, "retire": 0.25})))
    contacts = kinds(race.events, "contact")
    assert contacts and all(c["gap_s"] < 1.0 for c in contacts)
    assert kinds(race.events, "damage") and any(p["cause"] == "collision" for p in kinds(race.events, "retirement"))
    damaged = {p["car"] for p in kinds(race.events, "damage")}
    assert all(race.cars[c].damage_s > 0 for c in damaged)
    assert race.exposure_s > 0


def test_damage_slows_the_car_by_the_stated_loss():
    from engine.state import lap_time_potential
    race = new_race(incident_bundle())
    car = race.cars[race.grid[0]]
    base = lap_time_potential(car, race, 0.0)
    car.damage_s = 0.5
    assert lap_time_potential(car, race, 0.0) == pytest.approx(base + 0.5)


def test_chaos_multipliers_scale_the_incident_rates():
    b = incident_bundle(mech=0.01, contact=0.004)
    base = run_race(b, {"seed": 4, "circuit": "Test"}, policies={}, start_tyres={i: "MEDIUM" for i in _ids(b)})[1]
    calm = run_race(b, {"seed": 4, "circuit": "Test", "incident_multipliers": {"incident_rate": 0.0, "reliability_rate": 0.0}},
                    policies={}, start_tyres={i: "MEDIUM" for i in _ids(b)})[1]
    wild = run_race(b, {"seed": 4, "circuit": "Test", "incident_multipliers": {"incident_rate": 3.0, "reliability_rate": 3.0}},
                    policies={}, start_tyres={i: "MEDIUM" for i in _ids(b)})[1]
    n = lambda log: len(log.of_type("contact")) + len(log.of_type("retirement"))
    assert n(calm) == 0 < n(base) < n(wild)


def test_unknown_multiplier_is_refused():
    with pytest.raises(ValueError, match="unknown incident multipliers"):
        new_race(incident_bundle(), incident_multipliers={"luck": 2.0})


def test_first_lap_chaos_widens_the_start_spread():
    b = incident_bundle()
    b["start"].update(reaction_sd_s=0.2, launch_sd=0.3)

    def spread(m):
        return st.pstdev(c.launch_at for c in new_race(b, incident_multipliers={"first_lap_chaos": m}).cars.values())
    assert spread(3.0) > 2.5 * spread(1.0)


def test_sc_response_bias_raises_the_chance_of_a_safety_car_after_a_stopped_car():
    def sc_count(bias):
        n = 0
        for seed in range(30):
            b = incident_bundle(mech=0.1, on_track=1.0, sc=0.3, vsc=0.0, laps=8)
            r = run(new_race(b, seed=seed, incident_multipliers={"sc_response_bias": bias}))
            n += sum(1 for e in r.events if e["type"] == "safety_deployed")
        return n
    assert sc_count(3.0) > sc_count(1.0)


def test_a_far_cars_failures_do_not_depend_on_another_teams_stop():
    b = incident_bundle(mech=0.02)
    b["teams"] = b["teams"][:2]
    b["teams"][0]["pace_delta_s"] = -15.0
    b["teams"][0]["drivers"][1]["pace_delta_s"] = 15.0
    ids = ("T0A", "T0B", "T1A", "T1B")
    start = {i: "MEDIUM" for i in ids}
    base = run_race(copy.deepcopy(b), {"seed": 8, "circuit": "Test"}, policies={}, start_tyres=start)[1]
    alt = run_race(copy.deepcopy(b), {"seed": 8, "circuit": "Test"}, policies={}, start_tyres=start,
                   extra_actions={300: [CallBox("T0A", "HARD")]})[1]
    fails = lambda log, car: [(e["tick"], e["payload"]["cause"]) for e in log.of_type("retirement") if e["payload"]["car"] == car]
    assert base.of_type("retirement") and fails(alt, "T1B") == fails(base, "T1B")


def _ids(b):
    return [d["id"] for t in b["teams"] for d in t["drivers"]]


def test_a_circuit_that_maps_incidents_to_safety_cars_more_often_gets_more_of_them():
    def sc_count(scale):
        n = 0
        for seed in range(30):
            b = incident_bundle(mech=0.1, on_track=1.0, sc=0.3, vsc=0.0, laps=8)
            b["circuits"]["Test"]["sc_response_scale"] = scale
            n += sum(1 for e in run(new_race(b, seed=seed)).events if e["type"] == "safety_deployed")
        return n
    assert sc_count(0.0) == 0 < sc_count(1.0) < sc_count(3.0)
