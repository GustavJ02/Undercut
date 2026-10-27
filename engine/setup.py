"""Building a race from a bundle and a setup (design section 13), including all up-front random draws.

Everything random is drawn here, per car or per concern from keyed streams, in arrays indexed by tick, lap or stop number.
The number of draws therefore never depends on what happens in the race, and a change to one team's actions cannot
shift another car's draws.
"""
from functools import partial

from engine.rng import stream
from engine.state import MAX_STOPS, Car, Race, cliff_onset_from_uniform
from engine.weather import make_weather

# Chaos-mode multipliers on the fitted rates (design section 9); 1.0 is realistic mode.
DEFAULT_MULTIPLIERS = {"incident_rate": 1.0, "reliability_rate": 1.0, "first_lap_chaos": 1.0, "sc_response_bias": 1.0}
DEFAULT_SETUP = {"seed": 1, "circuit": None, "laps": None, "dt": 0.5, "incident_multipliers": {}, "weather": "dry"}
MAX_RACE_FACTOR = 3     # draws cover races up to this multiple of the green race time


def make_draws(bundle: dict, seed: int, car_ids, n_ticks: int, n_laps: int) -> dict:
    """All of a race's random numbers for one seed. The debrief draws alternative futures by calling this with another seed."""
    draws = {"safety_u": stream(seed, "safety", "trigger").random(n_ticks),
             "safety_dur": stream(seed, "safety", "duration").exponential(1.0, n_ticks), "car": {}}
    for cid in car_ids:
        r = partial(stream, seed, "car", cid)
        draws["car"][cid] = {
            "pass_u": r("pass").random(n_ticks),
            "lap_noise": r("lap_noise").standard_normal(n_laps) * bundle["lap_noise_s"],
            "est_noise": r("tyre_estimate").standard_normal(n_laps),
            "cliff_u": r("cliff").random(MAX_STOPS + 1),
            "pit": r("pit").standard_normal((MAX_STOPS + 1, 1)),
            "pit_u": r("pit_events").random((MAX_STOPS + 1, 2)),
            "start_gap": r("start").standard_normal(),
            "launch": r("launch").standard_normal(),
            "stint_s": r("stint_pace").standard_normal(MAX_STOPS + 1) * bundle["stint_pace_sd_s"],
            # rows: contact, outcome, failure, failure kind, hazard response, swap delay chance, swap delay length, driver argues, argument is a refusal (by tick)
            "inc_u": r("incidents").random((9, n_ticks)),
        }
    return draws


def redraw_future(race: Race, seed: int):
    """Give a race a different random future from the current moment: the state (grid, pace, tyres) stays, every draw from the
    next tick on comes from `seed`. Draws are indexed by tick, lap and stop, so this is exactly 'same world, other luck'."""
    if race.draws is None:
        n_ticks, n_laps = race.draw_dims
    else:
        n_ticks, n_laps = len(race.draws["safety_u"]), len(next(iter(race.draws["car"].values()))["lap_noise"])
    race.draws = make_draws(race.bundle, seed, list(race.cars), n_ticks, n_laps)


def build_race(bundle: dict, setup: dict) -> Race:
    setup = {**DEFAULT_SETUP, **setup}
    seed, dt = setup["seed"], setup["dt"]
    circuit_name = setup["circuit"] or next(iter(bundle["circuits"]))
    circuit = bundle["circuits"][circuit_name]
    laps = setup["laps"] or circuit["total_laps"]
    n_ticks = int(laps * circuit["base_lap_s"] * MAX_RACE_FACTOR / dt)
    n_laps = laps * 2 + 20

    entries = [(t, d) for t in bundle["teams"] for d in t["drivers"]]
    qual = bundle["start"]["qualifying_noise_s"]
    wk = bundle["weekend_pace"]
    team_day = {t["id"]: wk["team_sd_s"] * stream(seed, "weekend", "team", t["id"]).standard_normal() for t in bundle["teams"]}
    paces = {d["id"]: t["pace_delta_s"] + team_day[t["id"]] + d["pace_delta_s"]
             + wk["driver_sd_s"] * stream(seed, "weekend", "driver", d["id"]).standard_normal() for t, d in entries}
    by_pace = sorted(paces, key=lambda i: (paces[i], i))
    front = bundle["start"]["qualifying_front_share"]
    quali = {i: paces[i] + qual * (front + (1 - front) * k / (len(by_pace) - 1)) * stream(seed, "grid", i).standard_normal()
             for k, i in enumerate(by_pace)}
    grid = sorted(paces, key=lambda i: (quali[i], i))

    draws = make_draws(bundle, seed, grid, n_ticks, n_laps)
    cars = {}
    by_id = {d["id"]: (t, d) for t, d in entries}
    for cid in grid:
        team, drv = by_id[cid]
        cars[cid] = Car(id=cid, team=team["id"], driver=drv["name"], pace_s=paces[cid], compound="MEDIUM",
                        sets=dict(bundle["tyre_sets"]), cliff_onset=0.0)
    race = Race(seed=seed, dt=dt, total_laps=laps, circuit=circuit, bundle=bundle, cars=cars, draws=draws)
    race.circuit_name, race.grid = circuit_name, grid
    race.weather = make_weather(bundle, setup["weather"], seed, circuit["base_lap_s"], laps)
    race.mult = {**DEFAULT_MULTIPLIERS, **setup["incident_multipliers"]}
    unknown = set(setup["incident_multipliers"]) - set(DEFAULT_MULTIPLIERS)
    if unknown:
        raise ValueError(f"unknown incident multipliers: {sorted(unknown)}")
    return race


def fit_start_tyres(race: Race, car_id: str, compound: str):
    car = race.cars[car_id]
    if car.sets.get(compound, 0) <= 0:
        raise ValueError(f"{car_id} has no {compound} set")
    car.sets[compound] -= 1
    car.compound = compound
    car.compounds_used = [compound]
    car.cliff_onset = cliff_onset_from_uniform(race.bundle["compounds"][compound], race.draws["car"][car_id]["cliff_u"][0])
    car.stint_s = float(race.draws["car"][car_id]["stint_s"][0])


def start_race(race: Race, start_tyres: dict):
    """Fit the start tyres, place the grid with a random spread, and switch to RACING. Cars start behind the line."""
    st, chaos = race.bundle["start"], race.mult["first_lap_chaos"]
    base = race.circuit["base_lap_s"]
    for slot, cid in enumerate(race.grid):
        fit_start_tyres(race, cid, start_tyres[cid])
        car, d = race.cars[cid], race.draws["car"][cid]
        car.progress = -(slot + 1) * st["grid_gap_s"] / base               # standing on the grid, behind the line
        depth = st["launch_front_share"] + (1.0 - st["launch_front_share"]) * slot / max(len(race.grid) - 1, 1)
        car.launch_at = max(0.0, st["reaction_mean_s"] + st["reaction_sd_s"] * depth * chaos * d["start_gap"])
        car.launch_tau = st["launch_tau_s"] * max(0.3, 1.0 + st["launch_sd"] * depth * chaos * d["launch"])
        car.lt = car.pace_now = base + car.pace_s
    race.session = "RACING"
    race.events.append({"tick": 0, "type": "lights_out", "payload": {
        "grid": list(race.grid), "start_tyres": {cid: race.cars[cid].compound for cid in race.grid}}})
