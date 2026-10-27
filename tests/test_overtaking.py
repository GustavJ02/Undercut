import math

import pytest

from engine.tick import tick
from tests.helpers import make_bundle, new_race


def duel_bundle():
    b = make_bundle()
    b["teams"] = b["teams"][:1]
    b["circuits"]["Test"]["total_laps"] = 10
    return b


def first_lap_pass_rate(adv, dt, seeds=400):
    """Share of seeds in which the faster car passes within one lap of starting 0.3 s behind a car `adv` s/lap slower."""
    b = duel_bundle()
    passes = 0
    for seed in range(seeds):
        race = new_race(b, seed=seed, dt=dt)
        a, f = race.cars["T0A"], race.cars["T0B"]
        a.pace_s, f.pace_s = adv, 0.0
        a.lt, f.lt = a.pace_now, f.pace_now = 90.0 + adv, 90.0
        a.progress, f.progress = 0.10, 0.10 - 0.3 / 90.0
        a.lap_start_t = f.lap_start_t = 0.0
        for _ in range(int(90.0 / dt)):
            tick(race)
            if any(e["type"] == "pass" and e["payload"]["car"] == "T0B" for e in race.events):
                passes += 1
                break
    return passes / seeds


@pytest.mark.parametrize("dt", [0.5, 1.0])
def test_per_lap_pass_rate_matches_the_fitted_logistic_for_any_tick_size(dt):
    adv = 1.0
    ps = make_bundle()["passing"]
    expected = 1.0 / (1.0 + math.exp(-(ps["a"] + ps["b"] * adv)))
    rate = first_lap_pass_rate(adv, dt)
    se = math.sqrt(expected * (1 - expected) / 400)
    assert rate == pytest.approx(expected, abs=4 * se + 0.02)


def test_a_car_without_pace_advantage_is_held_behind():
    race = new_race(duel_bundle())
    a, f = race.cars["T0A"], race.cars["T0B"]
    a.progress, f.progress = 0.10, 0.10 - 0.3 / 90.0
    for _ in range(40):
        tick(race)
    assert f.progress < a.progress
    assert (a.progress - f.progress) * f.lt >= 0.29
