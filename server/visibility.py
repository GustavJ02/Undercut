"""The only path state takes to a client (design section 6): `project(race, team_id)` returns the visible state of a team.

Everyone sees public timing: standings, gaps, tyres, stops, sets left of every driver, the safety car status. A team also
sees its own cars' noisy tyre-loss estimate, pending box calls and radio. Hidden: true tyre loss and cliff position, pace,
lap time potential, random draws, other teams' plans. The result is plain JSON-serialisable data.
"""
import math

from engine import weather
from engine.state import tyre_loss_s

ESTIMATE_SD_S = 0.25        # noise on the team's own tyre-loss estimate, seconds per lap


def _gap(ahead, car):
    """Time gap to the car ahead. Once both have taken the flag on the same lap it is the difference of their finish times;
    a finished car's frozen position says nothing about it."""
    if ahead is None:
        return None
    if car.status == "FINISHED" or ahead.status == "FINISHED":
        if car.status == "FINISHED" and ahead.status == "FINISHED" and car.lap == ahead.lap:
            return round(float(car.finish_t - ahead.finish_t), 3)
        return None
    return round(float((ahead.progress - car.progress) * car.lt), 3)


def _swap_view(car, race):
    """A pending swap order of the team: who gets by, where, and how far it has got."""
    sw = car.swap
    if sw is None:
        return None
    phase = "asked" if race.time() < sw["active_at"] else "lifting" if sw["entered"] else "waiting"
    return {"with": sw["rear"], "anchor": sw["anchor"], "turn": sw["turn"], "phase": phase}


def _laps_down(leader, car):
    """Whole laps the leader has gained on the car: by distance on track, not by line crossings, so a car is not shown
    a lap down just because the leader crossed the line before it did."""
    if car.status not in ("FINISHED", "RUNNING", "IN_PIT"):
        return 0
    dist = lambda c: float(c.lap) if c.status == "FINISHED" else c.progress
    return max(int(math.floor(dist(leader) - dist(car) + 1e-9)), 0)


def _lap_frac(progress: float) -> float:
    """Position on the lap in [0, 1). A car standing on the grid has negative progress and is shown just before the line (0.99...)."""
    f = round(float(progress) % 1.0, 4)
    return 0.0 if f >= 1.0 else f


def _dirty_air_loss(race, car, running) -> float:
    """Pace the team's own car is losing to the car in front right now, from its telemetry (noisy, 0 in clear air).
    `running` is the running cars in race order."""
    if car.status != "RUNNING" or race.session != "RACING":
        return 0.0
    k = running.index(car.id)
    if k == 0:
        return 0.0
    tr = race.bundle["traffic"]
    gap = (race.cars[running[k - 1]].progress - car.progress) * car.lt
    if gap >= tr["window_s"]:
        return 0.0
    noise = race.draws["car"][car.id]["est_noise"][(max(car.lap, 0) + 7) % len(race.draws["car"][car.id]["est_noise"])] * 0.05
    return round(float(max(tr["loss_s"] * (1 - gap / tr["window_s"]) + noise, 0.0)), 3)


def _safety_car(race):
    """Where the safety car is while it is on the track (public, like every car), else None."""
    sc = race.safety
    if race.session != "SC" or sc is None or sc.get("phase") not in ("track", "in"):
        return None
    return {"lap_frac": _lap_frac(sc["pos"])}


def _grid_progress(race, position: int) -> float:
    """Where a car stands before the lights go out: behind the line by its slot, as the engine will place it at the start."""
    return -position * race.bundle["start"]["grid_gap_s"] / race.circuit["base_lap_s"]


def _public(race):
    """What every team sees at this moment: the timing rows, the lap, the weather. The same for all teams, so it is worked
    out once per tick and kept on the race (tick() clears it)."""
    key = (race.tick, race.session)
    if race.pub_cache is not None and race.pub_cache[0] == key:
        return race.pub_cache[1]
    order = race.order()
    cars, leader = race.cars, race.cars[order[0]]
    rows = []
    run = 0.0                           # gap to the leader as the sum of the intervals down the order: it grows with the place and Int is the step between rows
    for pos, cid in enumerate(order, 1):
        c = cars[cid]
        ahead = cars[order[pos - 2]] if pos > 1 else None
        interval = _gap(ahead, c)
        run = 0.0 if c is leader else round(run + interval, 3) if run is not None and interval is not None else _gap(leader, c)
        rows.append({
            "id": c.id, "team": c.team, "driver": c.driver, "position": pos, "lap": c.lap, "status": c.status,
            "lap_frac": _lap_frac(_grid_progress(race, pos) if race.session == "GRID" else c.progress),     # where the car is on the lap: public telemetry for the track map; a car on the grid is just behind the line
            "compound": c.compound, "tyre_age": c.age, "stops": c.stops, "compounds_used": list(c.compounds_used),
            "sets_remaining": dict(c.sets), "last_lap_s": None if c.last_lap_s is None else round(float(c.last_lap_s), 3),
            "gap_to_leader_s": run, "interval_s": interval,
            "laps_down": _laps_down(leader, c),
            "penalised": bool(c.breach),            # classified last for the two-compound rule: announced by the `penalty` event
        })
    running = [i for i in order if cars[i].status == "RUNNING"]
    data = (rows, min(max(leader.lap + 1, 1), race.total_laps), weather.visible(race), running)
    race.pub_cache = (key, data)
    return data


def project(race, team_id: str) -> dict:
    rows, leader_lap, wx, running = _public(race)
    own = {}
    for c in race.cars.values():
        if c.team != team_id:
            continue
        noise = race.draws["car"][c.id]["est_noise"][max(c.lap, 0)] * ESTIMATE_SD_S
        own[c.id] = {"est_tyre_loss_s": round(float(tyre_loss_s(c, race) + noise), 3),
                     "dirty_air_loss_s": _dirty_air_loss(race, c, running), "damage_loss_s": round(float(c.damage_s), 3),
                     "box_call": None if c.box_call is None else dict(c.box_call), "swap": _swap_view(c, race),
                     "order": None if c.opposite is None else {"target": c.opposite["target"], "compound": c.opposite["compound"]}}
    return {"time_s": race.time(), "session": race.session, "track_status": {"SC": "SCDeployed", "VSC": "VSCDeployed", "RED": "Red"}.get(
        race.session, "AllClear"), "race_lap": leader_lap, "total_laps": race.total_laps, "cars": [dict(r) for r in rows], "own": own,
        "weather": wx, "safety_car": _safety_car(race)}


def visible_numbers(view) -> list:
    """Every number in a projected view, for tests that search for leaked hidden values."""
    out = []

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)
        elif isinstance(x, float) and math.isfinite(x):
            out.append(x)
    walk(view)
    return out


# Events as public timing shows them. Everything not listed is hidden (default deny), and listed ones keep only these fields.
PUBLIC_EVENTS = {
    "lights_out": ("grid",),
    "lap": ("car", "lap", "lap_time", "compound", "age"),
    "pass": ("car", "passed"),
    "pit_in": ("car", "stop", "compound"),    # the set being fitted is in plain sight in the box; the duration is not
    "pit_out": ("car", "compound", "stop"),
    "safety_deployed": ("kind",),
    "red_flag": ("lap",),
    "restart": ("order", "lap"),
    "tyre_change": ("car", "compound"),
    "safety_ended": ("kind",),
    "safety_ending": ("kind",),
    "retirement": ("car", "lap"),
    "contact": ("cars", "lap"),
    "local_yellow": ("car", "lap"),
    "finish": ("car", "laps", "time"),
    "classification": ("order",),
    "penalty": ("car", "reason"),
}
OWN_EVENTS = {"box_ack": ("car", "ok", "message", "effective_lap"), "action_rejected": ("car", "reason"),
              "radio": ("car", "message", "id", "from", "speaker", "topic", "reply_to", "request"),
              "radio_request_closed": ("car", "id", "reason"), "swap_ack": ("car", "ok", "message"), "swap_done": ("car", "with_car", "kind", "message"),
              "swap_failed": ("car", "message"), "swap_cancelled": ("car", "message")}


def filter_event(event: dict, team_cars: set):
    """The part of an event a team may see, or None. Team events (box acknowledgements, radio) go to the owning team only."""
    t, p = event["type"], event["payload"]
    if t in PUBLIC_EVENTS:
        keep = PUBLIC_EVENTS[t]
    elif t in OWN_EVENTS and p.get("car") in team_cars:
        keep = OWN_EVENTS[t]
    else:
        return None
    return {"tick": event["tick"], "type": t, "payload": {k: p[k] for k in keep if k in p}}
