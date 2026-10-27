import statistics as st

import pytest

from engine.tick import tick
from tests.helpers import make_bundle, new_race, run


def start_bundle(**start):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = 3
    b["start"].update(start)
    b["compounds"]["MEDIUM"]["pace_offset_s"] = 0.0
    return b


def test_cars_wait_for_their_reaction_then_pull_away_from_standstill():
    b = start_bundle(reaction_mean_s=0.5, launch_tau_s=4.0)
    race = new_race(b)
    car = race.cars[race.grid[0]]
    p0 = car.progress
    for _ in range(int(0.5 / race.dt)):                      # the reaction time: nothing moves
        tick(race)
    assert car.progress == p0
    speeds = []
    last = car.progress
    for _ in range(40):
        tick(race)
        speeds.append((car.progress - last) / race.dt * car.lt)
        last = car.progress
    assert speeds[0] < 0.25 and speeds[-1] > 0.8 and speeds == sorted(speeds)        # speed rises towards racing speed


def test_a_slow_reaction_costs_places_on_a_tight_grid_and_a_quick_one_gains_them():
    b = start_bundle(reaction_mean_s=0.2, reaction_sd_s=0.0)
    race = new_race(b)
    lead, second = race.grid[0], race.grid[1]
    race.cars[lead].launch_at = 1.2          # a full second late: P2 is past before P1 has moved
    for _ in range(int(14 / race.dt)):
        tick(race)
    assert race.order().index(second) < race.order().index(lead)


def test_grid_order_is_kept_through_the_first_lap_when_nothing_differs():
    b = start_bundle(reaction_mean_s=0.2, reaction_sd_s=0.0, launch_sd=0.0)
    for team in b["teams"]:
        team["pace_delta_s"], team["drivers"][0]["pace_delta_s"], team["drivers"][1]["pace_delta_s"] = 0.0, 0.0, 0.0
    race = new_race(b)
    grid = list(race.grid)
    for _ in range(int(60 / race.dt)):
        tick(race)
    assert race.order() == grid


def test_first_lap_pass_shift_makes_early_passing_easier_and_only_in_lap_one():
    def passes(shift):
        b = start_bundle(first_lap_logit_shift=shift)
        n = 0
        for seed in range(12):
            race = run(new_race(b, seed=seed))
            n += sum(1 for e in race.events if e["type"] == "pass" and e["tick"] * race.dt < 90)
        return n
    assert passes(2.0) > passes(0.0)


def test_the_chaos_multiplier_widens_reaction_times():
    b = start_bundle(reaction_sd_s=0.1)
    calm = st.pstdev(c.launch_at for c in new_race(b).cars.values())
    wild = st.pstdev(c.launch_at for c in new_race(b, incident_multipliers={"first_lap_chaos": 3.0}).cars.values())
    assert wild == pytest.approx(3 * calm, rel=0.35)
