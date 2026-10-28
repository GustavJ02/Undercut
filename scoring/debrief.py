"""The debrief: what each human decision was worth, and how much of the result was luck (design section 15).

Everything is re-simulation. A finished race is replayed exactly (`engine.runner.Runner.from_log`), copied at the moment of a
decision, and each alternative is played on from there for N different futures. A future is the same world (grid, pace, tyres,
every car's state) with fresh luck for everything that has not happened yet (`redraw_future`). The N futures are the same for every
alternative of every decision (common random numbers), so every comparison is paired: an alternative is judged by its difference from
the decision actually taken, future by future, and that difference has a small standard error even though one race outcome is noisy.
After a decision the human cars follow the rule-based AI, re-planned from their current state.

The numbers add up. Let V_k be the expected score with the player's own calls up to and including decision k and the default
strategy after it (V_0: the default strategy from the lights). V_k is the value of the taken option of decision k, so it comes out of
the same replays as everything else:
    baseline = V_0;   expected from your calls = V_K (K decisions);   skill = V_K - V_0 = the sum of the contributions V_k - V_(k-1);
    luck = the score the race actually gave - V_K.
A decision's *miss* is a different number: the best alternative's paired advantage over the taken option. Misses do not add up.

Value is the team's expected points (both cars) and, next to it, its expected mean finishing position: a team that never
scores has points of zero in every alternative and the position still says something (a deviation from design section 15).
"""
import math
import os
import pickle
import statistics as st
from collections import namedtuple
from concurrent.futures import ProcessPoolExecutor

from engine import weather
from engine.actions import BoxOpposite, CallBox, CancelBox, SwapPositions, action_from_payload
from engine.race import bundle_sha
from engine.rng import stream
from engine.runner import Runner, car_teams, human_action_events
from engine.state import ALL_COMPOUNDS, COMPOUNDS
from scoring.points import car_points, team_result

DEFAULT_FUTURES = 24
SIGNIFICANT_SE = 2.0        # an option is better or worse than the taken one only when its paired difference is this many standard errors
SCORE_PLACES_WEIGHT, SCORE_PLACES_SCALE = 0.7, 3.0      # the strategist score blends skill in places (3 places gained = 1 unit) ...
SCORE_POINTS_WEIGHT, SCORE_POINTS_SCALE = 0.3, 4.0      # ... and in points (4 points gained = 1 unit) ...
SCORE_STEEPNESS = 3.0                                   # ... and puts it on 0..100 with 50 = as good as the AI: 3 places gained is about 89, one place about 67
RAIN_RELEVANT = 0.4         # intermediates and wets are offered when it rains, the track is not dry, or the forecast chance for any of the next laps is this high


class DebriefError(ValueError):
    pass


def _lower_priority():
    """Workers run niced so a live game on the same machine keeps its clock."""
    try:
        os.nice(10)
    except OSError:
        pass


def future_seed(seed: int, k: int) -> int:
    return int(stream(seed, "debrief", "future", k).integers(1, 2**31 - 1))


def final_order(race):
    return next(e for e in reversed(race.events) if e["type"] == "classification")["payload"]["order"]


# -- one branch of the race, run in a worker ----------------------------------------------------------------------------

def simulate_branch(task):
    """Play one alternative to the flag. Returns (points, mean position, each car's position, each car's points) of the human team,
    the cars in the order of `cars`."""
    blob, extra, seed, cars, hand_over = task
    runner = pickle.loads(blob)
    runner.reseed_future(seed)                  # branches are stored without draws; the future comes from the seed
    if hand_over:
        runner.step(extra)                      # the AI does not touch the human cars on the tick that applies the alternative
        runner.hand_to_ai()
    runner.run_to_end()
    order = final_order(runner.race)
    res = team_result(order, list(cars))
    return res["points"], res["mean_position"], tuple(order.index(c) + 1 for c in cars), tuple(car_points(order, c) for c in cars)


def simulate_batch(task):
    """Several futures of one alternative in one worker call, so the stored race crosses the process boundary once."""
    blob, extra, seeds, cars, hand_over = task
    return [simulate_branch((blob, extra, s, cars, hand_over)) for s in seeds]


def _dump(runner):
    """A runner as bytes without its pre-drawn random numbers (the bulk of its size): every branch redraws them anyway."""
    race = runner.race
    draws, race.draws = race.draws, None
    race.draw_dims = (len(draws["safety_u"]), len(next(iter(draws["car"].values()))["lap_noise"]))
    try:
        return pickle.dumps(runner)
    finally:
        race.draws = draws


BATCH = 4          # futures per worker call


def _submit(arms, seeds, cars, executor, hand_over=True):
    """Start every future of every alternative. Returns label -> calls (pending with an executor, finished without)."""
    out = {}
    for label, (blob, extra) in arms.items():
        tasks = [(blob, extra, seeds[i:i + BATCH], tuple(cars), hand_over) for i in range(0, len(seeds), BATCH)]
        out[label] = [executor.submit(simulate_batch, t) for t in tasks] if executor else [simulate_batch(t) for t in tasks]
    return out


def _gather(pending):
    return {label: [r for part in parts for r in (part.result() if hasattr(part, "result") else part)]
            for label, parts in pending.items()}


def _stats(values):
    return st.mean(values), (st.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else 0.0)


def _summarise(results):
    """Per alternative: expected points and position, and the paired differences from the first alternative."""
    ref = next(iter(results))
    out = {}
    for label, rows in results.items():
        pts, pos = [r[0] for r in rows], [r[1] for r in rows]
        dp = [a - b for a, b in zip(pts, [r[0] for r in results[ref]])]
        dq = [a - b for a, b in zip(pos, [r[1] for r in results[ref]])]
        (mp, sp), (mq, sq), (dmp, dsp), (dmq, dsq) = _stats(pts), _stats(pos), _stats(dp), _stats(dq)
        out[label] = {"points": mp, "points_se": sp, "position": mq, "position_se": sq,
                      "delta_points": dmp, "delta_points_se": dsp, "delta_position": dmq, "delta_position_se": dsq}
    return out


def _seeds(seed, futures):
    return [future_seed(seed, k) for k in range(1, futures + 1)]


def evaluate(arms, futures, seed, cars, executor=None, hand_over=True):
    """Expected value of each alternative. `arms` maps label -> (runner blob, actions to apply first); the first arm is the
    reference the others are compared with. Returns label -> dict with points, position and the paired differences."""
    return _summarise(_gather(_submit(arms, _seeds(seed, futures), cars, executor, hand_over)))



# -- reading the race back -----------------------------------------------------------------------------------------------

def check_log(bundle, log):
    """Refuse a log that cannot be replayed exactly or that is not a finished race with a human team."""
    h = log.header
    if h.get("bundle_sha") != bundle_sha(bundle):
        raise DebriefError("this race was run with a different parameter bundle than the one loaded now; it cannot be replayed")
    if not h.get("human_team") and not h.get("human_teams"):
        raise DebriefError("this log has no human team to debrief")
    if not any(e["type"] == "classification" for e in log.events):
        raise DebriefError("the race has not finished: a debrief during the race would reveal hidden information")


def replay_exactly(bundle, log):
    runner = Runner.from_log(bundle, log)
    runner.run_to_end()
    if runner.race.events != log.events:
        raise DebriefError("the replay does not reproduce the recorded race (engine or bundle changed since); no debrief")
    return runner


def _auto_stretches(events):
    """Per team, the tick ranges (start, end or None) in which its seat was on the autopilot (multiplayer)."""
    spans = {}
    for e in events:
        p = e["payload"]
        if e["type"] == "action" and p["kind"] == "SeatNote":
            if p["state"] == "auto":
                spans.setdefault(p["team"], []).append([e["tick"], None])
            elif spans.get(p["team"]) and spans[p["team"]][-1][1] is None:
                spans[p["team"]][-1][1] = e["tick"]
    return spans


def human_decisions(log, cars=None, owner=None):
    """Decision points of one human team, in time order: start tyres, calls and cancels, and safety-car periods in which a car
    could have boxed and did not. `cars` are the team's cars (default: every human car of the log, which is right for a solo race);
    `owner` maps car -> team and lets a multiplayer log skip what the AI did while the seat was on the autopilot."""
    cars = set(cars if cars is not None else log.header["human_cars"])
    ev = log.events
    out = []
    lights = next(e for e in ev if e["type"] == "lights_out")["payload"]["start_tyres"]
    for c in sorted(cars):
        out.append({"tick": 0, "kind": "start", "car": c, "taken": lights[c]})
    acks = {(e["tick"], e["payload"]["car"]): e["payload"]["ok"] for e in ev if e["type"] in ("box_ack", "swap_ack")}
    grouped, swaps = {}, []
    mine = human_action_events(ev, cars, owner) if owner else (e for e in ev if e["type"] == "action" and e["payload"]["car"] in cars)
    for e in mine:
        p = e["payload"]
        if p["kind"] != "SeatNote" and acks.get((e["tick"], p["car"]), False):
            if p["kind"] == "CancelSwap":
                continue                                     # taking an order back is not a strategy decision
            if p["kind"] == "SwapPositions":
                swaps.append({"tick": e["tick"], "kind": "swap", "car": p["car"], "taken": p, "actions": [action_from_payload(p)]})
            else:
                grouped.setdefault((e["tick"], p["car"]), []).append(p)
    out.extend(swaps)
    for (tick, car), acts in sorted(grouped.items()):
        out.append({"tick": tick, "kind": "call", "car": car, "taken": [(a["kind"], a["compound"], a.get("target")) for a in acts],
                    "actions": [action_from_payload(a) for a in acts]})
    deployed = [e for e in ev if e["type"] == "safety_deployed"]
    ended = [e["tick"] for e in ev if e["type"] == "safety_ended"]
    away = _auto_stretches(ev) if owner else {}
    on_auto = lambda c, t: any(a <= t and (b is None or t < b) for a, b in away.get(owner[c], ())) if owner else False
    for i, d in enumerate(deployed):
        end = next((t for t in ended if t > d["tick"]), d["tick"] + 400)
        for c in sorted(cars):
            if on_auto(c, d["tick"]):
                continue                                     # the AI had the seat: nothing was decided
            pitted = any(e["type"] == "pit_in" and e["payload"]["car"] == c and d["tick"] <= e["tick"] <= end for e in ev)
            if not pitted:
                out.append({"tick": d["tick"], "kind": "safety", "car": c, "taken": "stay out", "safety": d["payload"]["kind"]})
    order = {"start": 0, "call": 1, "swap": 2, "safety": 3}
    for d in out:
        d["cars"] = sorted(cars)
    return sorted(out, key=lambda d: (d["tick"], order[d["kind"]], d["car"]))


def _blob(runner):
    """The runner at this tick, ready to branch: the recorded human actions are dropped because each alternative says what the
    human does on this tick (otherwise the recorded call would be applied in every alternative)."""
    branch = runner.copy()
    branch.human_actions = {}
    return _dump(branch)


def rain_relevant(race) -> bool:
    """Whether wet-weather tyres are a fair thing to try at this moment: it is raining, the track is not dry, the race has been
    declared wet, or the forecast gives any of the next laps at least `RAIN_RELEVANT` chance of rain. Reads only what a team sees."""
    wx = weather.visible(race)
    return wx is not None and (wx["raining"] or wx["track"] != "dry" or wx["wet_race_declared"]
                               or max(wx["forecast_next_laps"], default=0.0) >= RAIN_RELEVANT)


def _options(log, runner):
    """Compounds worth trying as alternatives right now."""
    return ALL_COMPOUNDS if rain_relevant(runner.race) else COMPOUNDS


Arm = namedtuple("Arm", "blob extra name taken default")


def default_start(bundle, log, cars=None):
    """The start tyre the rule-based AI picks for each human car: the default strategy's choice."""
    r = Runner(bundle, log.header["setup"], human_team=None, human_cars=())
    return {c: r.race.cars[c].compound for c in (cars if cars is not None else log.header["human_cars"])}


def action_name(a, who=lambda car: car) -> str:
    """What a recorded action is called to a player. `who` turns a car id into the name to show (the driver's surname)."""
    if isinstance(a, CallBox):
        return f"Box {a.compound.lower()}"
    if isinstance(a, BoxOpposite):
        return f"Box opposite {who(a.target)}, {a.compound.lower()}"
    if isinstance(a, CancelBox):
        return "Cancel the call"
    if isinstance(a, SwapPositions):
        return "Swap " + ("as soon as possible" if a.anchor == "asap" else f"{a.anchor} turn {a.turn}")
    return type(a).__name__


def decision_arms(bundle, log, runner, d, earlier=(), defaults=None):
    """Alternatives for one decision as id -> Arm, the taken one first. `runner` is the exact replay advanced to the tick. `earlier` are
    the decisions already counted at this same tick: their actions are part of the history of this one, later ones are not (so the
    value after each decision is the value after exactly the decisions up to it). `defaults` are the AI's start tyres."""
    car, cars = d["car"], d.get("cars") or log.header["human_cars"]
    sets = runner.race.cars[car].sets
    history = [a for e in earlier for a in e.get("actions", ())]
    if d["kind"] == "start":
        defaults = defaults or default_start(bundle, log, cars)
        actual = dict(next(e for e in log.events if e["type"] == "lights_out")["payload"]["start_tyres"])
        decided = {e["car"] for e in earlier if e["kind"] == "start"}
        mine = {c: (actual[c] if c in decided else defaults[c]) for c in cars}
        comps = [d["taken"]] + [c for c in [defaults[car]] + list(_options(log, runner)) if c != d["taken"] and bundle["tyre_sets"].get(c, 0) > 0]
        arms = {}
        for comp in dict.fromkeys(comps):
            humans = getattr(runner, "humans", None)
            r = Runner(bundle, log.header["setup"], human_actions={}, start_tyres={**actual, **mine, car: comp},
                       human_team=log.header.get("human_team"), human_cars=cars, humans=humans)
            arms[f"start:{comp}"] = Arm(_blob(r), [], f"Start on {comp.lower()}", comp == d["taken"], comp == defaults[car])
        return arms
    blob = _blob(runner)
    who = lambda c: runner.race.cars[c].driver.split()[-1] if c in runner.race.cars else c        # the surname, as the race text says it
    if d["kind"] == "swap":
        a = d["actions"][0]
        arms = {"taken": Arm(blob, d["actions"] + history, action_name(a), True, False),
                "none": Arm(blob, history, "Don't swap", False, False)}
        if a.anchor != "asap":
            arms["asap"] = Arm(blob, [SwapPositions(a.car, a.with_car, "asap")] + history, "Swap as soon as possible", False, False)
        return arms
    if d["kind"] == "call":
        acts = d["actions"]
        cancel = all(isinstance(a, CancelBox) for a in acts)
        arms = {"taken": Arm(blob, acts + history, ", ".join(action_name(a, who) for a in acts), True, False),
                "none": Arm(blob, history, "Leave the call as it is" if cancel else "Stay out", False, False)}
        if not cancel:
            taken_comp = acts[0].compound if isinstance(acts[0], CallBox) else None
            for comp in _options(log, runner):
                if comp != taken_comp and sets.get(comp, 0) > 0:
                    arms[f"box:{comp}"] = Arm(blob, [CallBox(car, comp)] + history, f"Box {comp.lower()}", False, False)
        return arms
    arms = {"taken": Arm(blob, history, "Stay out", True, False)}
    for comp in _options(log, runner):
        if sets.get(comp, 0) > 0:
            arms[f"box:{comp}"] = Arm(blob, [CallBox(car, comp)] + history, f"Box {comp.lower()}", False, False)
    return arms


def _advance(runner, tick):
    while runner.race.tick < tick and runner.race.session != "FINISHED":
        runner.step()


def _paired(rows_a, rows_b, i=0):
    """Mean and standard error of rows_a - rows_b, future by future, for entry `i` of the rows (0 points, 1 mean position)."""
    return _stats([a[i] - b[i] for a, b in zip(rows_a, rows_b)])


def _verdict(dp, dp_se, places, places_se):
    """Better, worse or no meaningful difference from the taken option, by the paired difference against its standard error. Points
    decide; only when the points are identical in every future (a team that never scores) do the places."""
    if dp != 0 or dp_se != 0:
        gain, se = dp, dp_se
    else:
        gain, se = places, places_se
    if gain > SIGNIFICANT_SE * se and gain > 0:
        return "better"
    if gain < -SIGNIFICANT_SE * se and gain < 0:
        return "worse"
    return "same"


def _options_report(arms, rows):
    """Every option of one decision against the taken one (the first), on the same futures."""
    taken_id = next(iter(arms))
    base = rows[taken_id]
    out = []
    for oid, arm in arms.items():
        r = rows[oid]
        dp, dp_se = _paired(r, base, 0)
        places, places_se = _paired(base, r, 1)             # places gained: the taken option's mean position less this one's
        out.append({"id": oid, "name": arm.name, "taken": arm.taken, "default": arm.default, "points": st.mean(x[0] for x in r),
                    "delta_points": dp, "delta_points_se": dp_se, "places": places, "places_se": places_se,
                    "verdict": "taken" if oid == taken_id else _verdict(dp, dp_se, places, places_se)})
    return out


def _teams_of(bundle, log):
    """Each human team and its cars, from the log's header."""
    owner = car_teams(bundle)
    teams = {}
    for c in log.header["human_cars"]:
        teams.setdefault(owner[c], []).append(c)
    return {t: sorted(cs) for t, cs in teams.items()}


def run_debrief(bundle, log, futures=DEFAULT_FUTURES, workers=0, progress=None, team=None):
    """The whole debrief of a finished race, for one team: the only human team of a solo race, or `team` of a multiplayer one."""
    reports = run_debrief_all(bundle, log, futures, workers, progress, teams=None if team is None else [team])
    if team is None:
        if len(reports) != 1:
            raise DebriefError("this race has several human teams: say which team to debrief")
        return next(iter(reports.values()))
    return reports[team]


def run_debrief_all(bundle, log, futures=DEFAULT_FUTURES, workers=0, progress=None, teams=None, pool=None):
    """The debrief of every human team (or of `teams`), from one replay. `workers` > 0 spreads the re-simulations over processes.
    Each team is judged on its own calls: what it did is replayed as recorded, and from each of its decisions on every human car,
    this team's and the others', is played by the default strategy in all the futures."""
    check_log(bundle, log)
    final = replay_exactly(bundle, log)
    owner = car_teams(bundle)
    roster = _teams_of(bundle, log)
    if teams is not None:
        missing = [t for t in teams if t not in roster]
        if missing:
            raise DebriefError(f"no human team {missing[0]!r} in this race")
        roster = {t: roster[t] for t in teams}
    multi = len(_teams_of(bundle, log)) > 1
    seed = log.header["seed"]
    executor = pool or (ProcessPoolExecutor(max_workers=workers, initializer=_lower_priority) if workers else None)
    try:
        decisions = sorted(((t, d) for t, cs in roster.items() for d in human_decisions(log, cs, owner if multi else None)),
                           key=lambda td: (td[1]["tick"], {"start": 0, "call": 1, "swap": 2, "safety": 3}[td[1]["kind"]], td[1]["car"]))
        defaults = {t: default_start(bundle, log, cs) for t, cs in roster.items()}
        runner = Runner.from_log(bundle, log)
        seeds, jobs, counted = _seeds(seed, futures), {t: [] for t in roster}, {t: [] for t in roster}
        for t, d in decisions:
            _advance(runner, d["tick"])
            if runner.race.session == "FINISHED":
                break
            car = runner.race.cars[d["car"]]
            if d["kind"] == "safety" and (car.status != "RUNNING" or car.box_call or d["tick"] == 0
                                          or runner.race.total_laps - car.lap <= 3
                                          or not any(car.sets.get(c, 0) > 0 for c in _options(log, runner))):
                continue
            arms = decision_arms(bundle, log, runner, d, [e for e in counted[t] if e["tick"] == d["tick"]], defaults[t])
            if len(arms) < 2:
                continue
            counted[t].append(d)
            # every alternative of every decision goes to the workers at once; the replay moves on to the next decision meanwhile
            jobs[t].append((d, car.lap + 1, arms, _submit({k: (a.blob, a.extra) for k, a in arms.items()}, seeds, roster[t], executor)))
        total = sum(len(j) for j in jobs.values())
        if progress:
            progress(0, total)
        done, reports = 0, {}
        order = final_order(final.race)
        for t, cars in roster.items():
            gathered = []
            for d, lap, arms, pending in jobs[t]:
                gathered.append((d, lap, arms, _gather(pending)))
                done += 1
                if progress:
                    progress(done, total)
            reports[t] = build_report(log, t, cars, futures, gathered, order, marginal=multi)
        return reports
    finally:
        if executor and pool is None:
            executor.shutdown()


def unpenalised_order(events, order):
    """The classification without the two-compound penalty: the cars that finished in the order they crossed the line (most laps, then
    earliest), then the cars that did not finish as they were classified."""
    finished = {e["payload"]["car"]: (-e["payload"]["laps"], e["payload"]["time"]) for e in events if e["type"] == "finish"}
    ran = sorted((c for c in order if c in finished), key=lambda c: (finished[c], c))
    return ran + [c for c in order if c not in finished]


def build_report(log, team, cars, futures, gathered, order, marginal=False):
    """One team's report from its gathered decisions and the race's final order."""
    decisions = _chain(gathered, marginal)
    report = {"team": team, "cars": cars, "futures": futures, "decisions": decisions,
              "penalties": [e["payload"] for e in log.events if e["type"] == "penalty" and e["payload"]["car"] in cars]}
    report["summary"] = _summary(gathered, decisions, order, cars, marginal, unpenalised_order(log.events, order),
                                 {p["car"] for p in report["penalties"]})
    return report


def strategist_score(skill_places, skill_points, places_se=0.0, points_se=0.0):
    """The strategist score, 0 to 100, with 50 meaning as good as the AI would have been with the same cars. Skill in places gained and
    in points gained are put on one scale and blended (places carry a team that never scores, points reward scoring), then squashed
    smoothly, so a gain of three places is about 89 (a loss of three about 11) and one place is about 67, whatever the team. Returns (score, low, high),
    the last two from one standard error of the skill."""
    f = lambda x: 100.0 / (1.0 + math.exp(-SCORE_STEEPNESS * x))
    x = SCORE_PLACES_WEIGHT * skill_places / SCORE_PLACES_SCALE + SCORE_POINTS_WEIGHT * skill_points / SCORE_POINTS_SCALE
    se = math.hypot(SCORE_PLACES_WEIGHT * places_se / SCORE_PLACES_SCALE, SCORE_POINTS_WEIGHT * points_se / SCORE_POINTS_SCALE)
    return f(x), f(x - se), f(x + se)


def _chain(gathered, marginal=False):
    """The decisions as report entries, with each one's contribution and its miss. In a solo race the contribution is V_k - V_(k-1):
    V_0 is the default start of the first decision (the default strategy from the lights) and V_k the taken option of decision k, so the
    contributions add up. In a multiplayer race the other players' calls between two decisions also move the race, and that is not this
    player's skill: the contribution is the taken option against what the AI would have done from the same moment (`marginal`)."""
    first_arms, first_rows = gathered[0][2], gathered[0][3]
    prev = first_rows[next(k for k, a in first_arms.items() if a.default)]
    out = []
    for n, (d, lap, arms, rows) in enumerate(gathered, 1):
        options = _options_report(arms, rows)
        taken = options[0]
        now = rows[next(iter(arms))]
        if marginal:
            none = next((k for k, a in arms.items() if a.default), None) if d["kind"] == "start" else ("none" if "none" in arms else None)
            prev = rows[none] if none else now                      # a stay-out at a safety car is the AI's own choice: nothing to credit
        c_pts, c_pts_se = _paired(now, prev, 0)
        c_pos, c_pos_se = _paired(prev, now, 1)
        best = max(options, key=lambda o: (o["delta_points"], o["places"]))
        out.append({"index": n, "kind": d["kind"], "car": d["car"], "lap": lap, "tick": d["tick"], "call": taken["name"],
                    "value_after": taken["points"], "contribution_points": c_pts, "contribution_points_se": c_pts_se,
                    "contribution_places": c_pos, "contribution_places_se": c_pos_se,
                    "best": best["id"], "miss_points": max(best["delta_points"], 0.0), "miss_places": max(best["places"], 0.0) if best["id"] != taken["id"] else 0.0,
                    "significant": best["verdict"] == "better", "options": options})
        if not marginal:
            prev = now
    return out


def _summary(gathered, decisions, order, cars, marginal=False, free_order=None, penalised=()):
    """The page's top numbers. Baseline + skill + luck = the score the race actually gave, and skill is the sum of the contributions."""
    first_arms, first_rows = gathered[0][2], gathered[0][3]
    base = first_rows[next(k for k, a in first_arms.items() if a.default)]
    last_arms, last_rows = gathered[-1][2], gathered[-1][3]
    mine = last_rows[next(iter(last_arms))]
    actual = sum(car_points(order, c) for c in cars)
    mean = lambda rows, f: st.mean(f(r) for r in rows)
    if marginal:
        add = lambda key: sum(d[key] for d in decisions)
        add_se = lambda key: math.sqrt(sum(d[key] ** 2 for d in decisions))
        skill, skill_se, skill_pos, skill_pos_se = add("contribution_points"), add_se("contribution_points_se"), add("contribution_places"), add_se("contribution_places_se")
    else:
        skill, skill_se = _paired(mine, base, 0)
        skill_pos, skill_pos_se = _paired(base, mine, 1)
    baseline_points = mean(base, lambda r: r[0])
    expected_points = baseline_points + skill if marginal else mean(mine, lambda r: r[0])
    # A stop-rule penalty is the strategist's own doing (the rule is shown before the race and warned of during it), but not stopping is no
    # call, so the AI-hand-over would never see it: it is counted against the score here, as the places and points it cost.
    free = free_order or order
    pen_places = sum(order.index(c) - free.index(c) for c in penalised) / len(cars)
    pen_points = sum(car_points(free, c) - car_points(order, c) for c in penalised)
    score, score_low, score_high = strategist_score(skill_pos - pen_places, skill - pen_points, skill_pos_se, skill_se)
    return {"actual_points": actual, "actual_position": sum(order.index(c) + 1 for c in cars) / len(cars),
            "baseline_points": baseline_points, "baseline_points_se": _stats([r[0] for r in base])[1],
            "expected_points": expected_points, "expected_points_se": _stats([r[0] for r in mine])[1],
            "expected_points_sd": st.stdev([r[0] for r in mine]) if len(mine) > 1 else 0.0,
            "skill_points": skill, "skill_points_se": skill_se, "skill_places": skill_pos, "skill_places_se": skill_pos_se,
            "penalty_places": pen_places, "penalty_points": pen_points,
            "score": score, "score_low": score_low, "score_high": score_high,
            "luck_points": actual - expected_points,
            "baseline_position": mean(base, lambda r: r[1]), "expected_position": mean(base, lambda r: r[1]) - skill_pos if marginal else mean(mine, lambda r: r[1]),
            "drivers": [{"car": c, "actual_position": order.index(c) + 1, "actual_points": car_points(order, c),
                         "expected_position": mean(base, lambda r, i=i: r[2][i]) - skill_pos if marginal else mean(mine, lambda r, i=i: r[2][i]),
                         "expected_points": mean(base, lambda r, i=i: r[3][i]) + skill / len(cars) if marginal else mean(mine, lambda r, i=i: r[3][i]),
                         "baseline_position": mean(base, lambda r, i=i: r[2][i])} for i, c in enumerate(cars)],
            "biggest_miss": max(decisions, key=lambda d: (d["miss_points"], d["miss_places"]))["index"] if decisions else None,
            "worst_contribution": min(decisions, key=lambda d: d["contribution_points"])["index"] if decisions else None}


def format_report(report) -> str:
    s = report["summary"]
    lines = [f"Debrief for {report['team']} ({', '.join(report['cars'])}), {report['futures']} futures per option", "",
             f"Actual score: {s['actual_points']} points, mean position {s['actual_position']:.1f}",
             f"Baseline (the default strategy): {s['baseline_points']:.1f} points",
             f"Skill (your calls against the baseline): {s['skill_points']:+.1f} +/- {s['skill_points_se']:.1f} points",
             f"Strategist score: {s['score']:.0f} / 100 (50 = as good as the AI)"
             + (f", counting {s['penalty_places']:.1f} places lost to the stop-rule penalty" if s["penalty_places"] else ""),
             f"Expected from your calls: {s['expected_points']:.1f} points",
             f"Luck (the race against that; a normal swing is +/- {s['expected_points_sd']:.1f}): {s['luck_points']:+.1f} points", ""]
    for d in report["decisions"]:
        flag = "  <-- better was available" if d["significant"] else ""
        lines.append(f"Lap {d['lap']}, {d['car']}: {d['call']}   contribution {d['contribution_points']:+.1f} +/- {d['contribution_points_se']:.1f}{flag}")
        for o in d["options"]:
            mark = "*" if o["taken"] else " "
            diff = "taken" if o["taken"] else {"better": "better", "worse": "worse", "same": "no meaningful difference"}[o["verdict"]]
            figures = "" if o["taken"] else f"{o['delta_points']:+.2f} +/- {o['delta_points_se']:.2f} pts, {o['places']:+.2f} places  "
            lines.append(f" {mark} {o['name']:34s} {figures}{diff}")
    return "\n".join(lines)
