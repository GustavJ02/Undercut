"""Rule-based AI teams (design section 11). A policy sees only the projected visible state, like a human team.

Each car gets a baseline plan sampled from the bundle's stint-length survival curves and compound transitions. On top of
the plan the policy reacts to: tyre loss estimated from the team's own noisy readings (the cliff), an undercut threat from the
car behind, and safety car or VSC periods. A small chance of a suboptimal compound grows as team `quality` drops.
"""
import statistics

import numpy as np

from engine.actions import CallBox, SetStartTyres, SwapPositions
from engine.rivals import defaults as D
from engine.rng import stream
from engine.state import COMPOUNDS, WET_COMPOUNDS
from engine.weather import W_GRID


def dry_equivalent(compound: str) -> str:
    """Stint-length and switching statistics exist for the dry compounds only; wet-weather tyres borrow the medium's."""
    return compound if compound in COMPOUNDS else "MEDIUM"


class Policy:
    def start_tyres(self, view, ctx) -> list:
        raise NotImplementedError

    def decide(self, view, ctx) -> list:
        raise NotImplementedError


def sample_stint_length(survival: dict, u: float) -> int:
    """Inverse of a Kaplan-Meier survival curve: the age by which a fraction 1-u of stints have ended."""
    surv = np.asarray(survival["surv"], float)
    ages = np.asarray(survival["age"], float)
    return max(1, round(float(np.interp(u, surv[::-1], ages[::-1]))))


class RulePolicy(Policy):
    def __init__(self, team_id, seed, bundle, circuit_name, total_laps, exclude=()):
        """`exclude`: car ids a human controls; the policy leaves them alone."""
        self.team_id, self.seed, self.bundle, self.total_laps = team_id, seed, bundle, total_laps
        self.circuit_name = circuit_name
        self.exclude = set(exclude)
        self.traits = D.team_traits(seed, team_id)
        self.pit_loss = bundle["circuits"][circuit_name]["pit_loss_green_s"]
        self.stops_dist = bundle["circuits"][circuit_name]["stops_distribution"]
        self.stints = {**bundle["stints"]["pooled"], **bundle["stints"]["circuits"].get(circuit_name, {})}
        self.plans, self.seen_stops, self.draws = {}, {}, {}
        self.last_weather = {}
        self.swaps = []                                       # laps at which this team ordered a swap
        self.held = 0                                         # consecutive looks at a car held up by its team mate
        self.reasons = []                                     # why each call was made, for debugging and tests

    def _draw(self, car_id, name, index, n=2000):
        key = (car_id, name)
        if key not in self.draws:
            self.draws[key] = stream(self.seed, "policy", car_id, name).random(n)
        return float(self.draws[key][index % len(self.draws[key])])

    def _plan(self, car_id, start, sets):
        """List of (compound, planned stint length in laps); the last stint runs to the flag.

        The number of stops is drawn from what cars did at this circuit (`stops_distribution`). The compounds follow the
        observed transitions, with at least two different ones. Stint lengths are drawn from each compound's survival curve
        and rescaled so that the stints add up to the race, which keeps their relative shape but not a length that would
        need more stops than the data shows."""
        r = stream(self.seed, "policy", car_id, "plan")
        dist = self.stops_dist
        keys = sorted(dist, key=int)
        counts = np.array([dist[k] for k in keys], float)
        n_stops = int(keys[int(r.choice(len(counts), p=counts / counts.sum()))])
        trans, avail, comp = self.bundle["transitions"], dict(sets), start
        avail[start] = max(avail.get(start, 0) - 1, 0)
        seq = [start]
        for _ in range(n_stops):
            w = np.array([trans[comp].get(c, 0) * (avail.get(c, 0) > 0) for c in COMPOUNDS], float)
            comp = COMPOUNDS[int(r.choice(3, p=w / w.sum()))] if w.sum() else comp
            avail[comp] = avail.get(comp, 0) - 1
            seq.append(comp)
        if len(set(seq)) == 1:                                # two compounds are mandatory
            seq[-1] = next(c for c in COMPOUNDS if c != seq[-1] and sets.get(c, 0) > 0)
        raw = np.array([sample_stint_length(self.stints[c], r.random()) for c in seq], float)
        lengths = np.maximum(3, np.round(raw * self.total_laps / raw.sum())).astype(int)
        floor = max(3, int(np.ceil(self.bundle["strategy"]["first_stop_floor_share"] * self.total_laps)))
        if len(lengths) > 1:
            lengths[0] = max(lengths[0], floor)                   # nobody plans a stop a few laps in (the data's 5th percentile)
        lengths[-1] = self.total_laps
        return list(zip(seq, (int(x) for x in lengths)))

    def adopt_car(self, car_id, row, laps_left, tick):
        """Take over a car a human was driving: plan the rest of its race from where it is now.

        `row` is the car's public row (compound, tyre age, stops, compounds used, sets left). The plan list is indexed like a
        start-of-race plan (`plan[stops]` is the current stint), earlier entries are placeholders. The number of stops still to
        make comes from the circuit's stop-count distribution (at least one if the two-compound rule is not yet met, none
        if almost no race is left); lengths are drawn from the survival curves and rescaled to the laps left."""
        r = stream(self.seed, "policy", car_id, "adopt", tick)
        stops, comp, age = row["stops"], row["compound"], row["tyre_age"]
        sets = row["sets_remaining"]
        keys = sorted(self.stops_dist, key=int)
        counts = np.array([self.stops_dist[k] for k in keys], float)
        total = int(keys[int(r.choice(len(counts), p=counts / counts.sum()))])
        more = max(total - stops, 0)
        if len(set(row["compounds_used"])) < 2:
            more = max(more, 1)
        if laps_left <= 4:
            more = 0 if len(set(row["compounds_used"])) >= 2 else 1
        seq = [comp]
        avail = dict(sets)
        for _ in range(more):
            w = np.array([self.bundle["transitions"][dry_equivalent(seq[-1])].get(c, 0) * (avail.get(c, 0) > 0)
                          for c in COMPOUNDS], float)
            nxt = COMPOUNDS[int(r.choice(3, p=w / w.sum()))] if w.sum() else next(
                (c for c in COMPOUNDS if avail.get(c, 0) > 0), seq[-1])
            avail[nxt] = avail.get(nxt, 0) - 1
            seq.append(nxt)
        if more and len(set(seq) | set(row["compounds_used"])) < 2:
            seq[-1] = next((c for c in COMPOUNDS if c != comp and sets.get(c, 0) > 0), seq[-1])
        raw = np.array([max(sample_stint_length(self.stints[dry_equivalent(c)], r.random()) - (age if i == 0 else 0), 3)
                        for i, c in enumerate(seq)], float)
        lengths = np.maximum(3, np.round(raw * max(laps_left, 1) / raw.sum())).astype(int)
        planned = [age + int(lengths[0])] + [int(x) for x in lengths[1:]]
        if more == 0:
            planned = [10 ** 6]
        self.plans[car_id] = [(None, 0)] * stops + list(zip(seq, planned))
        self.exclude.discard(car_id)

    def start_tyres(self, view, ctx):
        acts = []
        for cid, car in ((c["id"], c) for c in view["cars"] if c["team"] == self.team_id and c["id"] not in self.exclude):
            sets = car["sets_remaining"]
            shares = self.bundle["start_compound_shares"]
            u = stream(self.seed, "policy", cid, "start").random()
            w = np.array([shares[c] * (sets.get(c, 0) > 0) for c in COMPOUNDS], float)
            comp = COMPOUNDS[int(np.searchsorted(np.cumsum(w / w.sum()), u))]
            self.plans[cid] = self._plan(cid, comp, sets)
            comp = self._for_conditions(comp, view.get("weather"), sets)
            acts.append(SetStartTyres(cid, comp))
        return acts

    @staticmethod
    def _dry_for(laps_left, sets):
        """Slicks for a drying track, chosen for the distance left: hard for a long way, soft for a sprint to the flag."""
        order = ("HARD", "MEDIUM", "SOFT") if laps_left >= 25 else ("MEDIUM", "HARD", "SOFT") if laps_left >= 12 else ("SOFT", "MEDIUM", "HARD")
        return next((c for c in order if sets.get(c, 0) > 0), None)

    def _for_conditions(self, compound, wx, sets, laps_left=30):
        """Keep a dry compound on a dry track and put wet-weather tyres on a wet one: the plan's choice, corrected for the weather."""
        if wx is None:
            return compound
        wet_now = wx["raining"] or wx["track"] != "dry"
        if wet_now and compound not in WET_COMPOUNDS:
            for c in ("INTERMEDIATE", "WET"):
                if sets.get(c, 0) > 0:
                    return c
        if not wet_now and compound in WET_COMPOUNDS:
            return self._dry_for(laps_left, sets) or compound
        return compound

    def _inters_pay(self, wx, on, laps_left):
        """Whether intermediates are expected to make up for the stop within the forecast: the track's wetness is projected lap by
        lap from the forecast chances (rain wets it at the bundle's rates, a dry lap dries it), and the lap-time tables the race
        itself uses (`weather.lap_delta`) give what a slick and an intermediate lose on it. The tyres change when the slick's extra
        time over the next laps exceeds the pit loss with a margin, so a forecast chance of rain on a dry track is not enough."""
        p = self.bundle["weather"]
        rate = 0.7 * p["wet_rate_per_lap"]["light"] + 0.3 * p["wet_rate_per_lap"]["heavy"]
        w = {"dry": 0.03, "damp": 0.27, "wet": 0.7}[wx["track"]]                # the middle of what each track label covers
        slick, inter = p["lap_delta"][on if on in COMPOUNDS else "MEDIUM"], p["lap_delta"]["INTERMEDIATE"]
        gain = 0.0
        for chance in wx["forecast_next_laps"][:min(laps_left, D.RAIN_LOOKAHEAD_LAPS)]:
            w = min(1.0, max(0.0, w + chance * rate - (1 - chance) * p["dry_rate_per_lap"]))
            gain += float(np.interp(w, W_GRID, slick) - np.interp(w, W_GRID, inter))
        return gain > D.INTER_GAIN_MARGIN * self.pit_loss

    def _weather_call(self, cid, row, view, idx, laps_left):
        """A change of tyre class for the weather: read the rain, the track label and the forecast, and compare the lap times
        of cars on different tyres in the public timing (the way a real pit wall spots a crossover). Returns a compound or None."""
        wx = view.get("weather")
        if wx is None or laps_left <= 3 or row["lap"] - self.last_weather.get(cid, -99) < 6:
            return None
        sets, on = row["sets_remaining"], row["compound"]
        times = {}
        for c in view["cars"]:
            if c["status"] == "RUNNING" and c["last_lap_s"] and c["lap"] >= 2 and c["tyre_age"] >= 3:      # not in or out laps
                times.setdefault(c["compound"], []).append(c["last_lap_s"])
        med = {k: float(statistics.median(v)) for k, v in times.items() if len(v) >= 2}
        slick = [med[k] for k in COMPOUNDS if k in med]
        slick_t = min(slick) if slick else None
        want = None
        if on in COMPOUNDS:                                                    # on slicks
            if (wx["raining"] and wx["track"] != "dry") or wx["track"] == "wet" or self._inters_pay(wx, on, laps_left) \
                    or (slick_t and "INTERMEDIATE" in med and med["INTERMEDIATE"] < slick_t - 1.5):
                want = "INTERMEDIATE"
        elif on == "INTERMEDIATE":
            calm = not wx["raining"] and max(wx["forecast_next_laps"][:3]) < 0.4
            gamble = wx["track"] == "damp" and self.traits["aggression"] > 0.65          # bold teams go to slicks a lap or two early
            drying = calm and (wx["track"] == "dry" or gamble)
            if drying or (slick_t and slick_t < med.get("INTERMEDIATE", 1e9) - 0.5):
                want = self._dry_for(laps_left, sets)
            elif wx["track"] == "wet" and wx["raining"] and "WET" in med and med["WET"] < med.get("INTERMEDIATE", 1e9) - 1.0:
                want = "WET"
        elif on == "WET" and (wx["track"] != "wet" or not wx["raining"]
                              or ("INTERMEDIATE" in med and med["INTERMEDIATE"] < med.get("WET", 1e9) - 0.5)):
            want = "INTERMEDIATE" if wx["track"] != "dry" else self._dry_for(laps_left, sets)
        if want is None or sets.get(want, 0) <= 0 or want == on:
            return None
        if self._draw(cid, "weather", idx) > 0.25 + 0.5 * self.traits["aggression"]:        # not every pit wall reacts at once
            return None
        self.last_weather[cid] = row["lap"]
        return want

    def _next_compound(self, row, plan, own_sets, mistake):
        stops = row["stops"]
        want = plan[stops + 1][0] if stops + 1 < len(plan) else None
        if want is None:                                     # plan used up: the compound least used so far
            order = sorted((c for c in COMPOUNDS if own_sets.get(c, 0) > 0), key=lambda c: (c in row["compounds_used"], c))
            want = next((c for c in order if c != row["compound"]), order[0] if order else None)
        if mistake:
            others = [c for c in COMPOUNDS if own_sets.get(c, 0) > 0 and c != want]
            want = others[0] if others else want
        if want and own_sets.get(want, 0) <= 0:
            want = next((c for c in COMPOUNDS if own_sets.get(c, 0) > 0), None)
        return want

    def _team_orders(self, view, rows, idx):
        """Swap the team's cars when the one behind has clearly fresher tyres (by the team's own tyre-loss estimates, which is
        all a pit wall can see of a car stuck in traffic) and has been held up by the one in front for a while: the order is
        called for the approach to the next corner that follows a long straight. At most twice a race."""
        mine = sorted((rows[c] for c in view["own"] if c not in self.exclude and rows[c]["status"] == "RUNNING"),
                      key=lambda r: r["position"])
        if len(mine) < 2 or view["session"] != "RACING" or len(self.swaps) >= 2:
            return []
        front, rear = mine[0], mine[1]
        lap = front["lap"]
        if rear["position"] != front["position"] + 1 or lap < 3 or self.total_laps - lap <= 4:
            return []
        if self.swaps and lap - self.swaps[-1] < 8 or view["own"][front["id"]]["swap"] or view["own"][rear["id"]]["swap"]:
            return []
        gap = rear["interval_s"]
        loss_front, loss_rear = view["own"][front["id"]]["est_tyre_loss_s"], view["own"][rear["id"]]["est_tyre_loss_s"]
        held_up = gap is not None and gap <= 1.2 and loss_front - loss_rear >= 0.4 and front["tyre_age"] - rear["tyre_age"] >= 3
        self.held = self.held + 1 if held_up else 0
        if self.held < 6:                                      # about half a minute of being held up before the call
            return []
        cs = self.bundle["circuits"][self.circuit_name]["corners"]
        need = self.bundle["team_orders"]["straight_min_gap"]
        for i, c in enumerate(cs):
            prev = cs[i - 1]["frac"] - (1.0 if i == 0 else 0.0)
            start = prev + self.bundle["team_orders"]["corner_halfwidth"]
            if c["frac"] - prev >= need and start > front["lap_frac"] - 1e-9 and start >= 0:
                self.swaps.append(lap)
                return [SwapPositions(front["id"], rear["id"], "before", c["n"])]
        return []

    def _red_flag_change(self, cid, row, own, idx, wx=None):
        """Tyre changes are free under a red flag: take new tyres if the set is well used or a stop is still planned."""
        if row["status"] != "RUNNING" or own["box_call"] or row["lap"] >= self.total_laps - 2:
            return []
        plan = self.plans.get(cid)
        if plan is None:
            return []
        planned = plan[row["stops"]][1] if row["stops"] < len(plan) else 10 ** 6
        worn = row["tyre_age"] >= 0.35 * planned or own["est_tyre_loss_s"] > 0.8
        stop_left = row["stops"] < len(plan) - 1 or len(set(row["compounds_used"])) < 2
        left = self.total_laps - row["lap"]
        wrong_class = self._for_conditions(row["compound"], wx, row["sets_remaining"], left) != row["compound"]
        if not ((worn and stop_left) or wrong_class):
            return []
        compound = self._next_compound(row, plan, row["sets_remaining"], False)
        compound = self._for_conditions(compound or row["compound"], wx, row["sets_remaining"], left)
        return [CallBox(cid, compound)] if compound and compound != row["compound"] or wrong_class else []

    def decide(self, view, ctx):
        acts, tr = [], self.traits
        idx = int(view["time_s"] / D.DECIDE_EVERY_S)
        rows = {c["id"]: c for c in view["cars"]}
        by_pos = view["cars"]
        acts += self._team_orders(view, rows, idx)
        for cid, own in view["own"].items():
            if cid in self.exclude:
                continue
            row = rows[cid]
            if view["session"] == "RED":
                acts += self._red_flag_change(cid, row, own, idx, view.get("weather"))
                continue
            laps_left = view["total_laps"] - row["lap"]
            prev_seen = self.seen_stops.get(cid)
            self.seen_stops[cid] = {c["id"]: c["stops"] for c in by_pos}
            if row["status"] != "RUNNING" or own["box_call"] or laps_left <= 2:
                continue
            plan = self.plans[cid]
            planned = plan[row["stops"]][1] if row["stops"] < len(plan) else 10 ** 6
            age = row["tyre_age"]
            wx = view.get("weather")
            wet_race = bool(wx and (wx["wet_race_declared"] or wx["raining"] or wx["track"] != "dry"))
            weather_comp = self._weather_call(cid, row, view, idx, laps_left)
            if weather_comp:
                self.reasons.append((cid, row["lap"], "weather"))
                acts.append(CallBox(cid, weather_comp))
                continue
            reason = None
            if age >= planned and laps_left > 3:
                reason = "plan"
            elif own["est_tyre_loss_s"] > D.TYRE_LOSS_PIT_S and laps_left > 3:
                reason = "tyres"
            elif len(set(row["compounds_used"])) < 2 and laps_left <= 5 and not wet_race:
                reason = "two-compound rule"
            elif view["session"] in ("SC", "VSC") and laps_left > 3 and row["stops"] < len(plan) - 1 \
                    and age >= planned * D.SAFETY_PIT_SHARE * (1.4 - 0.8 * tr["aggression"]):
                reason = "safety car"
            elif prev_seen and row["position"] < len(by_pos) and age >= planned * D.UNDERCUT_MIN_AGE_SHARE and laps_left > 3 \
                    and row["stops"] < len(plan) - 1:           # a free or early stop only replaces one still planned
                behind = by_pos[row["position"]]
                if behind["stops"] > prev_seen.get(behind["id"], behind["stops"]) \
                        and self._draw(cid, "undercut", idx) < tr["undercut_sensitivity"]:
                    reason = "cover undercut"
            if reason is None:
                continue
            mistake = self._draw(cid, "mistake", idx) < D.MISTAKE_RATE * (1 - tr["quality"]) * 10 and reason != "two-compound rule"
            compound = self._next_compound(row, plan, row["sets_remaining"], mistake)
            if compound:
                compound = self._for_conditions(compound, wx, row["sets_remaining"], laps_left)
                self.reasons.append((cid, row['lap'], reason))
                if reason == "two-compound rule" and compound in row["compounds_used"] and len(row["compounds_used"]) < 2:
                    compound = next((c for c in COMPOUNDS if c not in row["compounds_used"] and row["sets_remaining"].get(c, 0) > 0),
                                    compound)
                acts.append(CallBox(cid, compound))
        return acts
