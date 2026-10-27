"""One simulation tick: actions, safety car, car movement, passes, pit stops, lap and finish bookkeeping.

`tick(race, actions)` advances the race by `dt` and returns the events of that tick (they are also appended to
`race.events`). It reads no clock and no global randomness. Cars are processed front to back in a fixed order, each
limited by the new position of the car in front, so the result does not depend on iteration accidents.

Incidents (M2): mechanical failures, contacts between a car and the one it follows, retirements, and a race-control
response (safety car, VSC or local yellow) to a car stopped on track. A residual safety-car process fills the gap between
the fitted rate and what those incidents produce (see `circuits.*.residual_*` in the bundle). All draws are pre-drawn per
car and indexed by tick, so one team's actions cannot move another car's draws.

Known simplifications: lapped cars are not unlapped under the safety car; the safety car ends without a restart window;
driver errors and punctures are not modelled; a retired car vanishes from the track instead of waiting for marshals.
"""
import math

from engine import orders, weather
from engine.actions import BoxOpposite, CallBox, CancelBox, CancelSwap, SetStartTyres, SwapPositions
from engine.state import MAX_STOPS, WET_COMPOUNDS, cliff_onset_from_uniform, set_lap_time

ACTIVE = ("RUNNING", "IN_PIT")


def _apply_actions(race, actions, ev):
    for a in actions:
        extra = {"target": a.target} if isinstance(a, BoxOpposite) else {}        # only this action has one: other logs stay as they were
        _emit(race, ev, "action", kind=type(a).__name__, car=a.car, compound=getattr(a, "compound", None),
              with_car=getattr(a, "with_car", None), anchor=getattr(a, "anchor", None), turn=getattr(a, "turn", None), **extra)
        _apply_action(race, a, ev)


def apply_now(race, actions):
    """Apply actions without advancing the clock (a call made while paused). They are logged on the current tick, which is where
    a replay applies them too, so the next `tick` carries on as if they had been in its own list."""
    ev = []
    race.pub_cache = None
    _apply_actions(race, actions, ev)
    race.events.extend(ev)
    return ev


def tick(race, actions=()):
    ev = []
    race.pub_cache = None
    _apply_actions(race, actions, ev)
    if race.session in ("GRID", "FINISHED"):
        race.events.extend(ev)
        return ev
    race.tick += 1
    weather.step(race)
    if race.session == "RED":
        _red_tick(race, ev)
        race.events.extend(ev)
        return ev
    _update_safety(race, ev)
    _move_cars(race, ev)
    if not any(c.status in ACTIVE for c in race.cars.values()):
        race.session = "FINISHED"
        _classify(race, ev)
    race.events.extend(ev)
    return ev


def _emit(race, ev, type_, **payload):
    ev.append({"tick": race.tick, "type": type_, "payload": payload})


def _cutoff_frac(race):
    c = race.circuit
    return c["pit_entry_frac"] - c["pit_call_cutoff_frac"]


def _apply_action(race, a, ev):
    car = race.cars.get(a.car)
    if car is None:
        return _emit(race, ev, "action_rejected", car=a.car, reason="unknown car")
    if isinstance(a, SetStartTyres):
        return _emit(race, ev, "action_rejected", car=a.car, reason="start tyres are fixed once the lights go out")
    if isinstance(a, CancelSwap):
        return orders.cancel(race, car, lambda t, **p: _emit(race, ev, t, **p))
    if isinstance(a, SwapPositions):
        return orders.request(race, a, ev, lambda t, **p: _emit(race, ev, t, **p),
                              lambda row: race.draws["car"][a.car]["inc_u"][row][min(race.tick, len(race.draws["safety_u"]) - 1)])
    if car.status != "RUNNING":
        return _emit(race, ev, "box_ack", car=car.id, ok=False, message="car is not running on track")
    if isinstance(a, BoxOpposite):
        return _arm_opposite(race, car, a, ev)
    if race.session == "RED":
        return _red_action(race, car, a, ev)
    frac = car.progress - math.floor(car.progress)
    lap = max(0, math.floor(car.progress))
    if isinstance(a, CallBox):
        eff = lap + 1 if frac > _cutoff_frac(race) else lap
        if car.sets.get(a.compound, 0) <= 0:
            return _emit(race, ev, "box_ack", car=car.id, ok=False, message=f"no {a.compound} set left")
        if eff >= race.total_laps - 1:
            return _emit(race, ev, "box_ack", car=car.id, ok=False, message="no point in boxing on the last lap")
        car.box_call = {"compound": a.compound, "effective_lap": eff}
        msg = f"Box confirmed, {a.compound.lower()}" if eff == lap else f"Too late, box next lap, {a.compound.lower()}"
        _emit(race, ev, "box_ack", car=car.id, ok=True, message=msg, effective_lap=eff)
    elif isinstance(a, CancelBox):
        call = car.box_call
        if call is None and car.opposite is not None:
            car.opposite = None
            return _emit(race, ev, "box_ack", car=car.id, ok=True, message="Box opposite cancelled")
        if call is None:
            return _emit(race, ev, "box_ack", car=car.id, ok=False, message="no call to cancel")
        if call["effective_lap"] == lap and frac > _cutoff_frac(race):
            return _emit(race, ev, "box_ack", car=car.id, ok=False, message="too late to cancel")
        car.box_call = None
        _emit(race, ev, "box_ack", car=car.id, ok=True, message="Box cancelled")


def _who(car):
    """How a car is named in a line of text: its driver's surname (never the id)."""
    return car.driver.split()[-1]


def _arm_opposite(race, car, a, ev):
    """Give the call: it is settled later, at the car's own pit entry (`_settle_opposite`)."""
    tgt = race.cars.get(a.target)
    no = lambda msg: _emit(race, ev, "box_ack", car=car.id, ok=False, message=msg)
    if race.session not in ("RACING", "SC", "VSC"):
        return no("no box opposite while the race is stopped")
    if tgt is None or tgt.team == car.team or tgt.status != "RUNNING":
        return no("choose a rival who is running on track")
    if not 0 < tgt.progress - car.progress < 1:
        return no(f"{_who(tgt)} is not ahead of us")
    if car.sets.get(a.compound, 0) <= 0:
        return no(f"no {a.compound} set left")
    if car.box_call is not None or car.opposite is not None:
        return no("cancel the current call first")
    car.opposite = {"target": tgt.id, "compound": a.compound, "stops": tgt.stops}
    _emit(race, ev, "box_ack", car=car.id, ok=True, message=f"Box opposite {_who(tgt)}, {a.compound.lower()} if we box")


def _settle_opposite(race, car, prev, new, ev):
    """The car reaches its pit entry with a box-opposite call: it boxes if the rival ahead did not, and stays out if it did. The
    rival is public to look at from the car, so no hidden state is read; no calling cutoff applies."""
    e = race.circuit["pit_entry_frac"]
    entry = math.floor(prev - e) + 1 + e
    if not prev < entry <= new:
        return
    op, car.opposite = car.opposite, None
    tgt = race.cars[op["target"]]
    say = lambda ok, msg: _emit(race, ev, "box_ack", car=car.id, ok=ok, message=msg)
    if tgt.status == "RETIRED" or tgt.progress < entry <= new:      # nobody to look at: the call is void and we stay out
        return say(False, f"Box opposite void: {_who(tgt)} is not ahead")
    if tgt.status == "IN_PIT" or tgt.stops > op["stops"]:
        return say(True, f"{_who(tgt)} has boxed: stay out")
    if car.sets.get(op["compound"], 0) <= 0:
        return say(False, f"{_who(tgt)} stayed out but there is no {op['compound'].lower()} set left")
    car.box_call = {"compound": op["compound"], "effective_lap": math.floor(entry - e)}
    say(True, f"{_who(tgt)} stayed out: box, {op['compound'].lower()}")


def _leader(race):
    return max((c for c in race.cars.values() if c.status in ACTIVE), key=lambda c: (c.progress, c.id), default=None)


def _per_tick(rate_per_lap, race):
    return 1.0 - (1.0 - min(rate_per_lap, 0.999)) ** (race.dt / race.circuit["base_lap_s"])


SC_WARNING_LAPS = 1.0       # race control announces the safety car coming in a lap before it does
VSC_WARNING_LAPS = 0.15     # and the end of a VSC about ten seconds before it


def _update_safety(race, ev):
    lead = _leader(race)
    if lead is None:
        return
    sf = race.bundle["safety"]
    if race.session == "RACING" and 0 < lead.progress < race.total_laps - 1 and not race.leader_finished:
        circ = race.circuit
        boost = sf["early_boost"] if lead.progress < 2 else 1.0
        p_sc = _per_tick(circ["residual_sc_rate_per_lap"] * boost * race.mult["sc_response_bias"] * weather.factor(race, "sc"), race)
        p_vsc = _per_tick(circ["residual_vsc_rate_per_lap"] * boost * weather.factor(race, "vsc"), race)
        u = race.draws["safety_u"][race.tick - 1]
        kind = "SC" if u < p_sc else "VSC" if u < p_sc + p_vsc else None
        if kind:
            _deploy_safety(race, ev, kind, lead, "unattributed incident")
    elif race.session == "SC":
        _update_safety_car(race, ev, lead)
    elif race.session == "VSC" and (lead.progress - race.safety["start"] >= race.safety["duration"] or race.leader_finished):
        _emit(race, ev, "safety_ended", kind=race.session)
        race.session, race.safety = "RACING", None
    elif race.session == "VSC" and not race.safety.get("warned"):
        left = race.safety["duration"] - (lead.progress - race.safety["start"])
        if left <= VSC_WARNING_LAPS:                                           # "VSC ending"
            race.safety["warned"] = True
            _emit(race, ev, "safety_ending", kind=race.session)


def _update_safety_car(race, ev, lead):
    """The safety car as a car of its own. It comes out of the pit exit when the leader is about to pass it, leads the field at its slow
    pace, and when the period is over goes into the pit at the next entry. Green flag is shown when the leader crosses the start / finish
    line after that, and nobody may overtake before crossing it. Phases: waiting (in the pit), track, in (heading for the entry), gone."""
    sf, circ, sc = race.bundle["safety"], race.circuit, race.safety
    base = circ["base_lap_s"]
    entry = circ["pit_entry_frac"]
    if race.leader_finished:
        _emit(race, ev, "safety_ended", kind="SC")
        race.session, race.safety = "RACING", None
        return
    left = sc["duration"] - (lead.progress - sc["start"])
    sc.setdefault("phase", "track")                                          # a period set up by hand (tests) has the car already out
    sc.setdefault("pos", lead.progress + 2.0 * sf["sc_gap_s"] / base)
    ph = sc["phase"]
    if ph == "waiting":
        if left <= 0:
            sc["phase"], sc["line"] = "gone", math.floor(lead.progress) + 1       # it never came out: green at the next line
        elif sc["pos"] - lead.progress <= 2.0 * sf["sc_gap_s"] / base:
            sc["phase"] = "track"
    elif ph in ("track", "in"):
        sc["pos"] += race.dt / (base * sf["sc_lap_factor"])
        if "in_at" not in sc:                                                    # the pit entry it will use: the first one once the period is over
            sc["in_at"] = entry + math.ceil(sc["pos"] + max(left, 0.0) - entry)
        if ph == "track" and sc["in_at"] - sc["pos"] <= SC_WARNING_LAPS:        # "safety car in this lap": it comes in at the entry of this lap
            sc["phase"], sc["warned"] = "in", True
            _emit(race, ev, "safety_ending", kind="SC")
        elif ph == "in" and sc["pos"] >= sc["in_at"]:
            sc["phase"], sc["line"] = "gone", math.ceil(sc["in_at"])
    if sc["phase"] == "gone" and lead.progress >= sc["line"]:
        _emit(race, ev, "safety_ended", kind="SC")
        race.green_line = float(sc["line"])
        race.session, race.safety = "RACING", None


def _deploy_safety(race, ev, kind, lead, cause):
    sf = race.bundle["safety"]
    mean, floor = (sf["sc_laps"], 2.0) if kind == "SC" else (sf["vsc_laps"], 1.0)
    dur = max(floor, race.draws["safety_dur"][race.tick - 1] * mean)
    race.safety_count += 1
    race.safety = {"kind": kind, "start": lead.progress, "duration": dur}
    if kind == "SC":                       # it waits at the next pit exit ahead of the leader
        exit_frac = (race.circuit["pit_entry_frac"] + race.circuit["pit_lane_frac"]) % 1.0
        race.safety.update(phase="waiting", pos=exit_frac + math.ceil(lead.progress - exit_frac))
    race.session = kind
    _emit(race, ev, "safety_deployed", kind=kind, cause=cause, laps=round(dur, 2))


def _hazard_response(race, ev, car):
    """A car has stopped on track: race control answers with a red flag, a safety car, a VSC or a local yellow."""
    hr = race.bundle["incidents"]["hazard_response"]
    p_red = min(0.6, hr["red"] * weather.factor(race, "red"))
    p_sc = min(1.0 - p_red, hr["sc"] * race.circuit["sc_response_scale"] * race.mult["sc_response_bias"])
    p_vsc = min(hr["vsc"], 1.0 - p_red - p_sc)
    u = car_draw(race, car, 4)
    lead = _leader(race)
    can = race.session == "RACING" and lead is not None and lead.progress < race.total_laps - 2 and not race.leader_finished
    kind = "RED" if u < p_red else "SC" if u < p_red + p_sc else "VSC" if u < p_red + p_sc + p_vsc else None
    if kind == "RED" and can:
        _deploy_red(race, ev, f"{_who(car)} stopped on track")
    elif kind in ("SC", "VSC") and can:
        _deploy_safety(race, ev, kind, lead, f"{_who(car)} stopped on track")
    elif kind == "RED":
        _emit(race, ev, "local_yellow", car=car.id, lap=car.lap)
    else:
        _emit(race, ev, "local_yellow", car=car.id, lap=car.lap)


def _deploy_red(race, ev, cause):
    """Red flag: every car stops where it is (a car in the pit lane completes its stop first); the race is held for a short
    window in which free tyre changes can be called, then restarts from a standing start in the running order."""
    for c in race.cars.values():
        if c.status == "IN_PIT":
            c.progress = c.pit["exit_progress"]
            _exit_pit(race, c, ev)
    race.red = {"hold": max(1, round(race.bundle["incidents"]["red_flag"]["hold_s"] / race.dt))}
    race.session, race.safety = "RED", None
    race.green_line = float("-inf")
    durations = race.bundle["incidents"]["red_flag"]["durations_min"]
    _emit(race, ev, "red_flag", cause=cause, lap=_leader(race).lap + 1, typical_min=round(sum(durations) / len(durations), 1))


def _red_action(race, car, a, ev):
    """During a red flag a tyre change costs no time: a call is kept until the restart and fits the tyres then."""
    if isinstance(a, CallBox):
        if car.sets.get(a.compound, 0) <= 0:
            return _emit(race, ev, "box_ack", car=car.id, ok=False, message=f"no {a.compound} set left")
        car.box_call = {"compound": a.compound, "effective_lap": -1}
        return _emit(race, ev, "box_ack", car=car.id, ok=True, message=f"Tyre change confirmed, {a.compound.lower()}",
                     effective_lap=-1)
    if car.box_call is None:
        return _emit(race, ev, "box_ack", car=car.id, ok=False, message="no call to cancel")
    car.box_call = None
    _emit(race, ev, "box_ack", car=car.id, ok=True, message="Tyre change cancelled")


def _red_tick(race, ev):
    race.red["hold"] -= 1
    if race.red["hold"] <= 0:
        _restart(race, ev)


def _restart(race, ev):
    """Free tyre changes, then a standing restart: running order, one lap count for everybody, grid behind the line."""
    st, chaos = race.bundle["start"], race.mult["first_lap_chaos"]
    base, now = race.circuit["base_lap_s"], race.time()
    running = sorted((c for c in race.cars.values() if c.status == "RUNNING"), key=lambda c: (-c.progress, c.id))
    if not running:
        race.session, race.red = "RACING", None
        return
    laps_done = max(c.lap for c in running)
    for slot, car in enumerate(running):
        call = car.box_call
        if call and car.sets.get(call["compound"], 0) > 0:
            _fit_tyres(race, car, call["compound"])
            car.stops += 1
            _emit(race, ev, "tyre_change", car=car.id, compound=car.compound)
        car.box_call = None
        d = race.draws["car"][car.id]
        depth = st["launch_front_share"] + (1.0 - st["launch_front_share"]) * slot / max(len(running) - 1, 1)
        car.lap, car.restart_k = laps_done, laps_done
        car.progress = laps_done - (slot + 1) * st["grid_gap_s"] / base
        car.launch_at = now + max(0.0, st["reaction_mean_s"] + st["reaction_sd_s"] * depth * chaos * d["start_gap"])
        car.launch_tau = st["launch_tau_s"] * max(0.3, 1.0 + st["launch_sd"] * depth * chaos * d["launch"])
        car.lap_start_t = now
        set_lap_time(car, race, laps_done)
    race.session, race.red, race.restart_t = "RACING", None, now
    _emit(race, ev, "restart", order=[c.id for c in running], lap=laps_done + 1)


def _fit_tyres(race, car, compound):
    """Put a fresh set of `compound` on the car (shared by pit stops and red-flag changes)."""
    k = min(car.stops + 1, MAX_STOPS)
    car.sets[compound] -= 1
    car.compound, car.age = compound, 0
    car.cliff_onset = cliff_onset_from_uniform(race.bundle["compounds"][compound], race.draws["car"][car.id]["cliff_u"][k])
    car.stint_s = float(race.draws["car"][car.id]["stint_s"][k])
    if compound not in car.compounds_used:
        car.compounds_used.append(compound)


def car_draw(race, car, row):
    return race.draws["car"][car.id]["inc_u"][row][race.tick - 1]


def _retire(race, car, ev, cause, where):
    car.status, car.retired_t, car.retired_where, car.box_call, car.pit = "RETIRED", race.time(), where, None, None
    car.swap = car.opposite = None
    _emit(race, ev, "retirement", car=car.id, cause=cause, where=where, lap=car.lap)
    if where == "track":
        _hazard_response(race, ev, car)


def _incidents(race, car, ahead, gap_s, ev):
    """Mechanical failure of `car`, and contact with the car it follows. Returns False if `car` is out."""
    inc = race.bundle["incidents"]
    h = inc["mechanical_per_car_lap"] * race.mult["reliability_rate"] * _reliability_factor(race, car)
    if h > 0 and car_draw(race, car, 2) < _per_tick(h, race):
        _retire(race, car, ev, "mechanical", "track" if car_draw(race, car, 3) < inc["mechanical_on_track_share"] else "pit")
        return False
    col = inc["collision"]
    if ahead is not None and race.session == "RACING" and gap_s < col["window_s"]:
        race.exposure_s += race.dt
        boost = col["first_lap_boost"] * race.mult["first_lap_chaos"] if car.progress < 2 else 1.0
        p = min(1.0, col["rate_per_exposure_s"] * race.dt * boost * race.mult["incident_rate"] * weather.factor(race, "contact"))
        if car_draw(race, car, 0) < p:
            _emit(race, ev, "contact", cars=[car.id, ahead.id], lap=car.lap, gap_s=round(gap_s, 3))
            for victim in (car, ahead):
                u = car_draw(race, victim, 1)
                if u < col["outcome"]["retire"]:
                    _retire(race, victim, ev, "collision", "track")
                elif u < col["outcome"]["retire"] + col["outcome"]["damage"]:
                    victim.damage_s += col["damage_loss_s"]
                    _emit(race, ev, "damage", car=victim.id, loss_s=col["damage_loss_s"])
    return car.status != "RETIRED"


def _reliability_factor(race, car):
    """Team unreliability relative to the field mean, so equal team reliabilities leave the fitted rate unchanged."""
    if not race.team_unreliability:
        teams = race.bundle["teams"]
        mean = sum(1.0 - t["reliability"] for t in teams) / len(teams)
        race.team_unreliability = {t["id"]: (1.0 - t["reliability"]) / mean if mean > 0 else 1.0 for t in teams}
    return race.team_unreliability[car.team]


def _launch_share(race, car) -> float:
    """Share of this tick a car spends at full racing speed: none before it reacts to the lights, then speed rises as
    1 - exp(-t / tau) from standstill (the explicit start, design section 8)."""
    t0 = (race.tick - 1) * race.dt
    moving = min(max(t0 + race.dt - car.launch_at, 0.0), race.dt)
    if moving <= 0.0:
        return 0.0
    if car.launch_tau <= 0.0:
        return moving / race.dt
    since = t0 + race.dt - car.launch_at
    if since > 8 * car.launch_tau:
        return moving / race.dt
    return (moving / race.dt) * (1.0 - math.exp(-(since - moving / 2) / car.launch_tau))


def _logistic(x):
    return 1.0 / (1.0 + math.exp(-x))


def _move_cars(race, ev):
    b, dt = race.bundle, race.dt
    tr, sf, ps = b["traffic"], b["safety"], b["passing"]
    sc, vsc = race.session == "SC", race.session == "VSC"
    sfac = sf["sc_lap_factor"] if sc else sf["vsc_lap_factor"] if vsc else 1.0
    cars = sorted((c for c in race.cars.values() if c.status in ACTIVE), key=lambda c: (-c.progress, c.id))
    front = []                                    # processed running cars, nearest the front last
    for c in cars:
        c.p0 = c.progress
    for car in cars:
        prev = car.progress
        if car.status == "IN_PIT":
            need = (car.pit["exit_progress"] - prev) / car.pit["rate"]
            if need <= dt:                                  # leave the lane and spend the rest of the tick on track
                new = car.pit["exit_progress"] + (dt - need) / (car.lt * sfac)
            else:
                new = prev + car.pit["rate"] * dt
        else:
            ahead = front[-1] if front else None
            lt = car.lt
            lift = orders.step(race, car, ev, lambda t, **p: _emit(race, ev, t, **p)) if car.swap else 0.0
            if not _incidents(race, car, ahead, math.inf if ahead is None else (ahead.p0 - prev) * lt, ev):
                while front and front[-1].status == "RETIRED":
                    front.pop()
                continue
            while front and front[-1].status == "RETIRED":      # the car ahead was just taken out in a contact
                front.pop()
            ahead = front[-1] if front else None
            eff = lt * sfac
            if ahead is not None:
                gap_s = (ahead.p0 - prev) * lt
                if sc:
                    eff = lt if gap_s > sf["sc_gap_s"] * 1.5 else lt * sfac     # close the gap, then follow at SC speed
                elif not vsc and gap_s < tr["window_s"]:
                    eff = lt + tr["loss_s"] * (1.0 - max(gap_s, 0.0) / tr["window_s"])
            else:
                gap_s = math.inf
                if sc and race.safety.get("phase") in ("track", "in"):     # the leader closes up on the safety car and then follows it
                    gap_s = (race.safety["pos"] - prev) * lt
                    eff = lt if gap_s > sf["sc_gap_s"] * 1.5 else lt * sfac
            eff += lift                                        # a car yielding by order gives pace away
            new = prev + _launch_share(race, car) * dt / eff
            if ahead is not None:
                gap_min = (sf["sc_gap_s"] / (lt * sfac) if sc else tr["min_gap_s"] / lt)
                new = min(new, max(ahead.progress - gap_min, prev))
                if race.session == "RACING" and gap_s < ps["window_s"] and prev >= race.green_line:    # no overtaking before the green flag line
                    new = _try_pass(race, car, ahead, front, new, ev)
            elif sc and race.safety.get("phase") in ("track", "in"):
                new = min(new, max(race.safety["pos"] - sf["sc_gap_s"] / (lt * sfac), prev))
            if car.opposite is not None:
                _settle_opposite(race, car, prev, new, ev)
            entry = _pit_entry_crossing(race, car, prev, new)
            if entry is not None:
                left = dt * (new - entry) / (new - prev)    # the rest of the tick is spent in the pit lane
                _enter_pit(race, car, ev, entry)
                new = entry + car.pit["rate"] * left
        car.progress = new
        _crossings(race, car, prev, new, ev)
        if car.status == "IN_PIT" and car.progress >= car.pit["exit_progress"] - 1e-12:
            _exit_pit(race, car, ev)
        if car.status == "RUNNING":
            if front and car.progress > front[-1].progress:
                front.insert(len(front) - 1, car)           # a pass: the car is now ahead of the one it passed
            else:
                front.append(car)


def _try_pass(race, car, ahead, front, new, ev):
    ps = race.bundle["passing"]
    if car.hold_for == ahead.id and race.time() < car.hold_until:
        return new                                       # it just let us by on orders: no attack straight back
    if orders.forced_pass(race, car, ahead, (ahead.p0 - car.p0) * car.lt):    # the car in front lifts to let us by, on orders
        out = _do_pass(race, car, ahead, front, new, ev, 1.0)
        if out > ahead.progress:
            orders.complete(race, ahead, car, lambda t, **p: _emit(race, ev, t, **p))
        return out
    start_phase = car.lap == 0 or (race.restart_t is not None and race.time() - race.restart_t < 30.0)
    if start_phase and _launch_share(race, car) - _launch_share(race, ahead) > 0.25:
        # off the line a car that is clearly quicker away goes round one still waiting for the lights or bogged down
        return _do_pass(race, car, ahead, front, new, ev, 1.0)
    shift = race.bundle["start"]["first_lap_logit_shift"] * race.mult["first_lap_chaos"] if start_phase else 0.0
    # the fit used each driver's smoothed pace, not a single lap's noisy time: noise on a convex logistic would inflate passing
    adv = ahead.pace_now - car.pace_now
    p_lap = _logistic(ps["a"] + shift + ps["b"] * adv + race.circuit["passing_effect"])
    p_tick = 1.0 - (1.0 - p_lap) ** (race.dt / car.lt)
    if race.draws["car"][car.id]["pass_u"][race.tick - 1] >= p_tick:
        return new
    return _do_pass(race, car, ahead, front, new, ev, p_lap)


def _do_pass(race, car, ahead, front, new, ev, p_lap):
    gap_min = race.bundle["traffic"]["min_gap_s"] / car.lt
    target = ahead.progress + gap_min
    if len(front) >= 2 and target > front[-2].progress - gap_min:
        return new                                  # no room between the car passed and the one in front of it
    _emit(race, ev, "pass", car=car.id, passed=ahead.id, p_lap=round(p_lap, 4))
    return max(new, target)


def _pit_entry_crossing(race, car, prev, new):
    call = car.box_call
    if call is None:
        return None
    e = race.circuit["pit_entry_frac"]
    n = math.floor(prev - e) + 1
    entry_abs = n + e
    if prev < entry_abs <= new and n >= call["effective_lap"]:
        return entry_abs
    return None


def _enter_pit(race, car, ev, entry_abs):
    c, b = race.circuit, race.bundle
    ps, sf = b["pit_stop"], b["safety"]
    k = min(car.stops, MAX_STOPS)
    z = race.draws["car"][car.id]["pit"][k][0]
    u_slow, u_err = race.draws["car"][car.id]["pit_u"][k]
    delta = max(ps["stationary_mean_s"] * 0.5, ps["stationary_mean_s"] + ps["stationary_sd_s"] * z) - ps["stationary_mean_s"]
    delta += ps["slow_stop_extra_s"] * (u_slow < ps["slow_stop_prob"]) + ps["error_extra_s"] * (u_err < ps["error_prob"])
    f = c["pit_lane_frac"]
    sfac, ratio = {"SC": (sf["sc_lap_factor"], sf["sc_pit_ratio"]), "VSC": (sf["vsc_lap_factor"], sf["vsc_pit_ratio"])}.get(
        race.session, (1.0, 1.0))
    duration = f * car.lt * sfac + ratio * c["pit_loss_green_s"] + delta
    car.status, car.swap = "IN_PIT", None
    car.pit = {"exit_progress": entry_abs + f, "rate": f / duration, "duration": duration}
    _emit(race, ev, "pit_in", car=car.id, compound=car.box_call["compound"], duration=round(duration, 2), stop=car.stops + 1,
          session=race.session)


def _exit_pit(race, car, ev):
    call = car.box_call
    if call and car.sets.get(call["compound"], 0) > 0:
        _fit_tyres(race, car, call["compound"])
    car.stops += 1
    car.status, car.pit, car.box_call = "RUNNING", None, None
    set_lap_time(car, race, car.lap)
    _emit(race, ev, "pit_out", car=car.id, compound=car.compound, stop=car.stops)


def _crossings(race, car, prev, new, ev):
    for k in range(math.floor(prev) + 1, math.floor(new) + 1):
        if car.status == "FINISHED":
            break
        t_cross = (race.tick - 1) * race.dt + race.dt * (k - prev) / (new - prev)
        if k == 0 or k == car.restart_k:                # the start line of the race or of a restart: no lap is completed
            car.lap_start_t = t_cross
            set_lap_time(car, race, k)
            car.restart_k = None
            continue
        car.lap, car.age = k, car.age + 1
        car.last_lap_s = t_cross - car.lap_start_t
        car.lap_start_t = t_cross
        _emit(race, ev, "lap", car=car.id, lap=k, lap_time=car.last_lap_s, compound=car.compound, age=car.age)
        if k >= race.total_laps or race.leader_finished:
            car.status, car.finish_t, car.progress = "FINISHED", t_cross, float(k)
            if not race.leader_finished:
                race.leader_finished = True
            _emit(race, ev, "finish", car=car.id, laps=k, time=t_cross)
            break
        set_lap_time(car, race, k)


def _classify(race, ev):
    for c in race.cars.values():
        waived = race.weather is not None and race.weather["declared"] or bool(set(c.compounds_used) & set(WET_COMPOUNDS))
        c.breach = c.status == "FINISHED" and len(set(c.compounds_used)) < 2 and not waived
        if c.breach:
            _emit(race, ev, "penalty", car=c.id, reason="two-compound rule not met", effect="classified last")
    order = sorted(race.cars.values(), key=lambda c: (c.status == "RETIRED", c.breach, -c.lap,
                                                      c.finish_t if c.finish_t is not None else -c.retired_t, c.id))
    race.final_order = [c.id for c in order]
    _emit(race, ev, "classification", order=race.final_order)
