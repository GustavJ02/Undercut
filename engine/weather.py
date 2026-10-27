"""Weather: a hidden rain schedule, a track wetness that follows it, and what the teams get to see (design section 10).

Truth: a race has a scenario (dry, wet start, rain during the race), drawn at setup from the 2025-26 frequencies or forced by the
setup. A scenario fixes a schedule of rain intervals in race time and the track's starting wetness `W` (0 dry, 1 soaked).
Rain wets the track, a dry spell dries it. `W` is hidden; teams see whether it is raining, a track label (dry, damp, wet) and a
forecast. The forecast is published before the race with the reliability the data shows (the stated chance of rain against
whether it rained) and updated through the race as a short-range look ahead whose accuracy falls with the horizon.

Effect: a lap time gets a delta that depends on the tyre and on `W` (tables in the bundle: slicks lose a lot on a wet track,
intermediates are best on a damp one, wets on a soaked one; the crossovers come out of those tables). Wet races have more
incidents (multipliers in the bundle, fitted where the data allows). Everything is drawn from the seed up front, so the weather
is the same whatever the teams do.
"""
import numpy as np

from engine.rng import stream

SCENARIOS = ("dry", "wet_start", "rain_during")
W_GRID = (0.0, 0.25, 0.5, 0.75, 1.0)
LEVEL_RATE = {1: "light", 2: "heavy"}
FORECAST_HORIZON = 10          # laps


def _pick_scenario(bundle, setup_weather, r):
    if setup_weather in SCENARIOS:
        return setup_weather
    if setup_weather != "realistic":
        raise ValueError(f"unknown weather {setup_weather!r}")
    probs = bundle["weather"]["scenario_probs"]
    u, acc = r.random(), 0.0
    for name in SCENARIOS:
        acc += probs[name]
        if u < acc:
            return name
    return "dry"


def make_weather(bundle, setup_weather: str, seed: int, base_lap_s: float, total_laps: int) -> dict:
    """Draw the race's weather from the seed. Returns the hidden state; nothing in it depends on what teams do."""
    w = bundle["weather"]
    r = stream(seed, "weather")
    scenario = _pick_scenario(bundle, setup_weather, r)
    durations = w["rain_durations_laps"]
    intervals, w0 = [], 0.0
    level = 1 if r.random() < 0.7 else 2
    if scenario == "wet_start":
        w0 = float(r.uniform(0.35, 0.85))
        d = float(durations[int(r.integers(len(durations)))])
        if r.random() < 0.5:                                    # the rain that wet the track is still falling at the start
            intervals.append((0.0, d * base_lap_s, level))
    elif scenario == "rain_during":
        start = float(w["rain_start_share"][int(r.integers(len(w["rain_start_share"])))])
        start = min(max(start, 0.1), 0.8)
        d = float(durations[int(r.integers(len(durations)))])
        intervals.append((start * total_laps * base_lap_s, (start * total_laps + d) * base_lap_s, level))
    rained = scenario != "dry"
    buckets = w["forecast"]["given_rain" if rained else "given_dry"]
    names = sorted(buckets, key=lambda k: int(k.split("-")[0]))
    probs = np.array([buckets[k] for k in names], float)
    lo, hi = (int(x) for x in names[int(r.choice(len(names), p=probs / probs.sum()))].split("-"))
    return {"scenario": scenario, "intervals": intervals, "w": w0, "w0": w0, "declared": False,
            "forecast_pct": int(round(float(r.uniform(lo, hi)) / 10.0) * 10), "noise": r.standard_normal(total_laps * 2 + 40),
            "base_lap_s": base_lap_s}


def raining(weather, t: float) -> int:
    """Rain level at race time t: 0 none, 1 light, 2 heavy."""
    for t0, t1, level in weather["intervals"]:
        if t0 <= t < t1:
            return level
    return 0


def step(race):
    """Advance the track wetness by one tick of rain or drying."""
    wx = race.weather
    if wx is None:
        return
    p = race.bundle["weather"]
    lap = race.dt / wx["base_lap_s"]
    level = raining(wx, race.time())
    if level:
        wx["w"] = min(1.0, wx["w"] + p["wet_rate_per_lap"][LEVEL_RATE[level]] * lap)
    else:
        wx["w"] = max(0.0, wx["w"] - p["dry_rate_per_lap"] * lap)
    if wx["w"] >= 0.3 and race.tick > 0:
        wx["declared"] = True                                   # a wet race: the two-compound rule no longer applies


def wetness(race) -> float:
    return 0.0 if race.weather is None else race.weather["w"]


def lap_delta(race, compound: str) -> float:
    """Seconds a lap loses on `compound` at the current wetness (on top of the dry lap time)."""
    if race.weather is None:
        return 0.0
    return float(np.interp(race.weather["w"], W_GRID, race.bundle["weather"]["lap_delta"][compound]))


def wear_factor(race, compound: str) -> float:
    """Wet-weather tyres wear faster on a track that is drying out (intermediates grain on a dry-ish surface)."""
    if race.weather is None or compound not in ("INTERMEDIATE", "WET"):
        return 1.0
    dry = 1.0 - min(1.0, race.weather["w"] / 0.5)
    return 1.0 + race.bundle["weather"]["dry_track_wear"] * dry


def factor(race, key: str) -> float:
    """Multiplier on an incident rate for the current wetness: 1 on a dry track, the bundle's value on a wet one."""
    if race.weather is None:
        return 1.0
    omega = min(1.0, race.weather["w"] / 0.4)
    return 1.0 + (race.bundle["weather"]["multipliers"][key] - 1.0) * omega


def visible(race) -> dict | None:
    """What every team may see: rain now, the state of the track, and the forecast."""
    wx = race.weather
    if wx is None:
        return None
    lap = race.dt / wx["base_lap_s"]
    t = race.time()
    label = "dry" if wx["w"] < 0.1 else "damp" if wx["w"] < 0.45 else "wet"
    here = int(t / wx["base_lap_s"])
    ahead = []
    for h in range(1, FORECAST_HORIZON + 1):
        a, b = t + (h - 1) * wx["base_lap_s"], t + h * wx["base_lap_s"]
        truth = 1.0 if any(t0 < b and t1 > a for t0, t1, _ in wx["intervals"]) else 0.0
        skill = 0.85 - 0.5 * (h - 1) / FORECAST_HORIZON
        base = wx["forecast_pct"] / 100.0
        p = skill * truth + (1 - skill) * base + 0.07 * wx["noise"][min(here + h, len(wx["noise"]) - 1)]
        ahead.append(round(float(min(max(p, 0.0), 1.0)), 2))
    del lap
    return {"raining": raining(wx, t) > 0, "track": label, "wet_race_declared": wx["declared"],
            "forecast_pre_race_pct": wx["forecast_pct"], "forecast_next_laps": ahead}
