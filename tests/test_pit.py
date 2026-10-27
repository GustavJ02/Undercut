import pytest

from engine.actions import CallBox
from engine.tick import tick
from tests.helpers import make_bundle, new_race, run


def clean_air_bundle(laps=3):
    b = make_bundle()
    for c in b["compounds"].values():
        c["wear_s_per_lap"] = 0.0
    b["pit_stop"].update(stationary_sd_s=0.0, slow_stop_prob=0.0, error_prob=0.0)
    # one team: the leader meets no traffic except the team mate, 30 s a lap slower and still ahead after a 22 s stop
    b["teams"] = [dict(b["teams"][0], pace_delta_s=-8.0)]
    b["teams"][0]["drivers"][1]["pace_delta_s"] = 30.0
    b["circuits"]["Test"]["total_laps"] = laps
    return b


def ack_of(events):
    return next(e for e in events if e["type"] == "box_ack")["payload"]


def leader_of(race):
    return race.grid[0]


def test_a_stop_costs_the_fitted_pit_loss_when_nothing_else_differs():
    b = clean_air_bundle()
    base = run(new_race(b))
    lead = leader_of(base)
    stopped = new_race(b)
    run(stopped, {2: [CallBox(lead, "MEDIUM")]})
    loss = stopped.cars[lead].finish_t - base.cars[lead].finish_t
    assert loss == pytest.approx(b["circuits"]["Test"]["pit_loss_green_s"], abs=0.15)
    assert stopped.cars[lead].stops == 1


def test_stop_fits_the_called_compound_and_consumes_a_set():
    b = clean_air_bundle()
    race = new_race(b, start="MEDIUM")
    lead = leader_of(race)
    run(race, {2: [CallBox(lead, "HARD")]})
    car = race.cars[lead]
    assert car.compound == "HARD" and car.sets["HARD"] == 1 and car.compounds_used == ["MEDIUM", "HARD"]
    assert car.age == 2                                    # new set at the end of lap 1, two laps run on it


def test_a_call_after_the_cutoff_applies_to_the_next_lap():
    b = clean_air_bundle(laps=10)
    race = new_race(b)
    lead = race.cars[leader_of(race)]
    while not (lead.lap == 1 and lead.progress - 1 > 0.92):
        tick(race)
    ev = tick(race, [CallBox(lead.id, "HARD")])
    ack = [e for e in ev if e["type"] == "box_ack"][0]["payload"]
    assert ack["ok"] and "Too late" in ack["message"] and ack["effective_lap"] == 2


def test_cannot_call_a_compound_with_no_sets_left_or_on_the_last_lap():
    b = clean_air_bundle(laps=10)
    b["tyre_sets"] = {"SOFT": 0, "MEDIUM": 3, "HARD": 2}
    race = new_race(b)
    lead = leader_of(race)
    ev = tick(race, [CallBox(lead, "SOFT")])
    assert not ack_of(ev)["ok"] and "no SOFT" in ack_of(ev)["message"]
    while race.cars[lead].lap < race.total_laps - 1:
        tick(race)
    ev = tick(race, [CallBox(lead, "HARD")])
    assert not ack_of(ev)["ok"] and "last lap" in ack_of(ev)["message"]


def test_one_compound_all_race_is_classified_last():
    race = run(new_race(clean_air_bundle()))
    cls = race.events[-1]["payload"]["order"]
    assert race.events[-1]["type"] == "classification"
    assert all(race.cars[c].breach for c in cls)           # nobody changed compound, so everyone breaches
    assert [e["type"] for e in race.events].count("penalty") == len(race.cars)


def test_the_view_marks_the_cars_classified_last_so_screens_do_not_show_their_race_time_as_a_gap():
    from server.visibility import project
    race = run(new_race(clean_air_bundle()))
    rows = project(race, race.cars[race.final_order[0]].team)["cars"]
    assert all(r["penalised"] for r in rows)
    assert not any(r["penalised"] for r in project(new_race(clean_air_bundle()), "T0")["cars"])
