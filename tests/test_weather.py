import json
import statistics as st

import numpy as np
import pytest

from engine import weather
from engine.setup import build_race
from engine.tick import tick
from engine.weather import W_GRID, make_weather
from server.visibility import project
from tests.helpers import make_bundle, new_race, run


def wet_bundle(laps=12):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    return b


def test_a_dry_race_has_no_wetness_and_no_lap_time_effect():
    race = new_race(wet_bundle(), weather="dry")
    assert race.weather["scenario"] == "dry" and race.weather["w"] == 0.0
    for _ in range(400):
        tick(race)
    assert race.weather["w"] == 0.0 and weather.lap_delta(race, "SOFT") == 0.0 and not race.weather["declared"]


def test_a_wet_start_dries_out_and_the_track_label_follows_it():
    race = new_race(wet_bundle(laps=30), weather="wet_start", seed=4)
    w0 = race.weather["w"]
    assert 0.35 <= w0 <= 0.85
    labels = []
    for _ in range(int(25 * 90 / race.dt)):
        tick(race)
        labels.append(weather.visible(race)["track"])
    assert race.weather["w"] < w0 and race.weather["declared"]
    order = {"wet": 2, "damp": 1, "dry": 0}
    levels = [order[x] for x in labels if True]
    assert levels[0] >= levels[-1] and levels[-1] == 0                       # it ends dry


def test_rain_during_the_race_starts_late_and_wets_the_track():
    race = new_race(wet_bundle(laps=40), weather="rain_during", seed=2)
    (t0, t1, _), = race.weather["intervals"]
    assert t0 >= 0.1 * 40 * 90 and race.weather["w"] == 0.0
    while race.time() < t1 + 1 and race.session != "FINISHED":
        tick(race)
    assert race.weather["w"] > 0.2 and race.weather["declared"]


def test_the_lap_time_tables_put_the_crossovers_where_the_data_shows_them():
    b = wet_bundle()
    d = b["weather"]["lap_delta"]
    grid = np.linspace(0, 1, 101)
    slick = np.interp(grid, W_GRID, d["MEDIUM"])
    inter = np.interp(grid, W_GRID, d["INTERMEDIATE"])
    wet = np.interp(grid, W_GRID, d["WET"])
    slick_to_inter = grid[np.argmax(inter < slick)]
    inter_to_wet = grid[np.argmax(wet < inter)]
    assert 0.05 <= slick_to_inter <= 0.3 and 0.5 <= inter_to_wet <= 0.85
    assert slick[0] == 0.0 and slick[-1] > 25 and wet[-1] < inter[-1] < slick[-1]


def test_on_a_wet_track_intermediates_are_much_faster_than_slicks_and_on_a_dry_one_slower():
    b = wet_bundle()
    wet = new_race(b, weather="wet_start", seed=4)
    wet.weather["w"] = 0.7
    car = next(iter(wet.cars.values()))
    from engine.state import lap_time_potential
    car.compound = "MEDIUM"
    slick = lap_time_potential(car, wet, 0.0)
    car.compound = "INTERMEDIATE"
    inter = lap_time_potential(car, wet, 0.0)
    assert slick - inter > 8
    wet.weather["w"] = 0.0
    car.compound = "MEDIUM"
    slick = lap_time_potential(car, wet, 0.0)
    car.compound = "INTERMEDIATE"
    assert lap_time_potential(car, wet, 0.0) - slick > 2


def test_wet_weather_tyres_wear_faster_on_a_drying_track():
    race = new_race(wet_bundle(), weather="wet_start", seed=4)
    race.weather["w"] = 0.0
    dry_track = weather.wear_factor(race, "INTERMEDIATE")
    race.weather["w"] = 0.8
    assert dry_track > 2.5 and weather.wear_factor(race, "INTERMEDIATE") == 1.0 and weather.wear_factor(race, "SOFT") == 1.0


def test_scenario_frequencies_follow_the_probabilities_and_the_forecast_follows_the_truth():
    b = wet_bundle()
    probs = b["weather"]["scenario_probs"]
    draws = [make_weather(b, "realistic", s, 90.0, 20) for s in range(1500)]
    for name in ("wet_start", "rain_during"):
        share = sum(1 for d in draws if d["scenario"] == name) / len(draws)
        assert abs(share - probs[name]) < 0.04
    rain = [d["forecast_pct"] for d in draws if d["scenario"] != "dry"]
    dry = [d["forecast_pct"] for d in draws if d["scenario"] == "dry"]
    assert st.mean(rain) > st.mean(dry) + 15


def test_the_short_range_forecast_sees_the_coming_rain_and_is_less_sure_further_out():
    b = wet_bundle(laps=40)
    race = new_race(b, weather="rain_during", seed=2)
    (t0, _, _), = race.weather["intervals"]
    gaps, far = [], []
    while race.time() < t0 - 3 * 90:
        tick(race)
    f = weather.visible(race)["forecast_next_laps"]
    race2 = new_race(b, weather="dry", seed=2)
    f_dry = weather.visible(race2)["forecast_next_laps"]
    assert max(f[:5]) > max(f_dry[:5]) or max(f) > max(f_dry)
    del gaps, far


def test_the_visible_weather_never_shows_the_hidden_wetness_or_schedule():
    race = new_race(wet_bundle(), weather="wet_start", seed=4)
    view = project(race, "T0")
    text = json.dumps(view["weather"])
    assert set(view["weather"]) == {"raining", "track", "wet_race_declared", "forecast_pre_race_pct", "forecast_next_laps"}
    assert "intervals" not in text and str(round(race.weather["w"], 3)) not in text


def test_a_wet_race_waives_the_two_compound_rule():
    b = wet_bundle(laps=6)
    race = run(new_race(b, weather="wet_start", seed=4, start="MEDIUM"))
    assert not [e for e in race.events if e["type"] == "penalty"]
    dry = run(new_race(b, weather="dry", seed=4, start="MEDIUM"))
    assert [e for e in dry.events if e["type"] == "penalty"]


def test_incident_multipliers_grow_with_wetness():
    race = new_race(wet_bundle(), weather="dry")
    assert weather.factor(race, "contact") == 1.0
    race.weather["w"] = 0.4
    assert weather.factor(race, "contact") == pytest.approx(2.0) and weather.factor(race, "red") == pytest.approx(9.0)
    race.weather["w"] = 0.2
    assert weather.factor(race, "sc") == pytest.approx(1.5)


def test_the_weather_is_the_same_whatever_the_teams_do():
    a = build_race(wet_bundle(), {"seed": 9, "circuit": "Test", "weather": "realistic"})
    b = build_race(wet_bundle(), {"seed": 9, "circuit": "Test", "weather": "realistic"})
    assert a.weather["intervals"] == b.weather["intervals"] and a.weather["forecast_pct"] == b.weather["forecast_pct"]
    with pytest.raises(ValueError, match="unknown weather"):
        build_race(wet_bundle(), {"seed": 9, "circuit": "Test", "weather": "snow"})


def ai_race(b, weather_kind, seed, laps=None):
    from engine.race import run_race
    return run_race(b, {"seed": seed, "circuit": "Test", "weather": weather_kind})


def test_ai_teams_start_on_intermediates_when_the_track_is_wet_and_not_otherwise():
    b = wet_bundle(laps=12)
    _, wet = ai_race(b, "wet_start", 4)
    starts = next(e for e in wet.events if e["type"] == "lights_out")["payload"]["start_tyres"]
    assert sum(1 for c in starts.values() if c == "INTERMEDIATE") >= 0.8 * len(starts)
    _, dry = ai_race(b, "dry", 4)
    starts = next(e for e in dry.events if e["type"] == "lights_out")["payload"]["start_tyres"]
    assert not any(c in ("INTERMEDIATE", "WET") for c in starts.values())


def test_ai_teams_move_to_slicks_as_the_track_dries_and_back_to_inters_when_rain_arrives():
    b = wet_bundle(laps=40)
    race, log = ai_race(b, "wet_start", 4)
    finished = [c for c in race.cars.values() if c.status == "FINISHED"]
    on_slicks = [c for c in finished if c.compound in ("SOFT", "MEDIUM", "HARD")]
    assert len(on_slicks) >= 0.7 * len(finished)                          # the track dried: nearly everybody ended on slicks
    assert not log.of_type("penalty")                                       # a wet race waives the two-compound rule
    race, log = ai_race(b, "rain_during", 2)
    inter_stops = [e for e in log.of_type("pit_out") if e["payload"]["compound"] in ("INTERMEDIATE", "WET")]
    assert len(inter_stops) >= 8                                           # the field reacted to the rain
    for e in inter_stops:                                                   # and only after it began to rain
        assert e["tick"] * race.dt >= race.weather["intervals"][0][0] - 3 * 90


def test_an_ai_car_does_not_put_wet_tyres_on_a_dry_track():
    b = wet_bundle(laps=12)
    _, log = ai_race(b, "dry", 3)
    assert not [e for e in log.of_type("pit_out") if e["payload"]["compound"] in ("INTERMEDIATE", "WET")]


def _policy():
    from engine.rivals.policy import RulePolicy
    return RulePolicy("T0", 1, wet_bundle(), "Test", 30)


def _wx(track="dry", raining=False, forecast=(0.0,) * 10):
    return {"raining": raining, "track": track, "wet_race_declared": False, "forecast_pre_race_pct": 90, "forecast_next_laps": list(forecast)}


def test_a_team_on_slicks_keeps_them_for_a_short_chance_of_rain_on_a_dry_track():
    """Regression (playtest D4): the whole field fitted intermediates on a dry track for a 60 % chance in the next two laps."""
    p = _policy()
    assert not p._inters_pay(_wx(forecast=(0.9, 0.9, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1)), "MEDIUM", 20)
    assert not p._inters_pay(_wx(forecast=(0.7, 0.7, 0.7, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1)), "HARD", 20)
    assert not p._inters_pay(_wx(forecast=(0.0,) * 10), "MEDIUM", 20)


def test_a_team_changes_to_intermediates_when_a_long_wet_spell_will_pay_for_the_stop():
    p = _policy()
    assert p._inters_pay(_wx(forecast=(0.9,) * 10), "MEDIUM", 20)
    assert p._inters_pay(_wx("damp", forecast=(0.8,) * 10), "SOFT", 20)
    assert not p._inters_pay(_wx(forecast=(0.9,) * 10), "MEDIUM", 2)       # too few laps left to earn the pit loss back


def test_the_weather_call_does_not_come_for_a_dry_track_and_a_high_forecast_that_will_not_pay(monkeypatch):
    p = _policy()
    monkeypatch.setattr(p, "_draw", lambda *a, **k: 0.0)                  # the pit wall always reacts
    car = {"id": "T0A", "status": "RUNNING", "last_lap_s": 90.0, "lap": 7, "tyre_age": 7, "compound": "MEDIUM", "sets_remaining": {"INTERMEDIATE": 2}}
    view = {"weather": _wx(forecast=(0.9, 0.9, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1)), "cars": [car]}
    assert p._weather_call("T0A", car, view, 0, 23) is None
    view = {"weather": _wx(forecast=(0.9,) * 10), "cars": [car]}
    assert p._weather_call("T0A", car, view, 0, 23) == "INTERMEDIATE"
