"""A race together with the AI teams that run it, stepped one tick at a time and copyable at any tick.

The same loop as the room's (`server/room.py`): human actions first, then, every few seconds, each AI team looks at its visible
state, then one `tick`. The debrief replays a finished race with this class, copies it at a decision, and plays the copies on
with other actions and other luck (`engine.setup.redraw_future`).
"""
import copy

from engine.actions import SeatNote, action_from_payload
from engine.rivals import defaults as D
from engine.rivals.policy import RulePolicy
from engine.setup import build_race, redraw_future, start_race
from engine.tick import tick
from server.visibility import project


def make_policies(bundle, race, human_team=None, human_cars=(), humans=None):
    """Rule-based AI for every team; the human cars are left to their player. `humans` maps each human team to its cars (several
    teams in a multiplayer race); `human_team` and `human_cars` are the one-team form of the same thing."""
    humans = humans if humans is not None else ({human_team: tuple(human_cars)} if human_team else {})
    return {t["id"]: RulePolicy(t["id"], race.seed, bundle, race.circuit_name, race.total_laps, exclude=humans.get(t["id"], ()))
            for t in bundle["teams"]}


def car_teams(bundle):
    return {d["id"]: t["id"] for t in bundle["teams"] for d in t["drivers"]}


def human_action_events(events, cars, owner):
    """The recorded `action` events that a player made, in order. While a seat is on the autopilot the AI's calls for its cars are
    in the log too (the same kind of event), so they are skipped between a seat's "auto" and "back" notes."""
    auto = set()
    for e in events:
        if e["type"] != "action":
            continue
        p = e["payload"]
        if p["kind"] == "SeatNote":
            (auto.add if p["state"] == "auto" else auto.discard)(p["team"])
            yield e
        elif p["car"] in cars and owner[p["car"]] not in auto:
            yield e


def adopt_cars(race, policies, car_ids):
    """Have each car's team policy plan its race from where it is now: a human car handed to the AI (the debrief's alternatives, or a
    multiplayer seat that went to the autopilot). The room and the replay both use this, so they plan alike. A car that is out of the
    race is left alone; one in the pits is planned like any other."""
    views = {}
    for cid in car_ids:
        car = race.cars[cid]
        pol = policies.get(car.team)
        if pol is None or car.status not in ("RUNNING", "IN_PIT"):
            continue
        if car.team not in views:
            views[car.team] = {c["id"]: c for c in project(race, car.team)["cars"]}
        row = dict(views[car.team][cid])
        call = car.box_call
        if call:                                    # a stop already called is as good as made: the AI plans what comes after it, not a second stop
            sets = dict(row["sets_remaining"])
            sets[call["compound"]] = sets.get(call["compound"], 0) - 1
            row.update(stops=row["stops"] + 1, compound=call["compound"], tyre_age=0, sets_remaining=sets,
                       compounds_used=list(row["compounds_used"]) + [call["compound"]])
        pol.adopt_car(cid, row, race.total_laps - row["lap"], race.tick)


class Runner:
    def __init__(self, bundle, setup, policies=None, human_actions=None, start_tyres=None, human_team=None, human_cars=(), humans=None):
        self.bundle, self.setup = bundle, dict(setup)
        self.race = build_race(bundle, self.setup)
        self.humans = {t: tuple(c) for t, c in humans.items()} if humans is not None else ({human_team: tuple(human_cars)} if human_team else {})
        self.human_team = human_team or (next(iter(self.humans)) if len(self.humans) == 1 else None)
        self.human_cars = tuple(c for cars in self.humans.values() for c in cars)
        self.policies = make_policies(bundle, self.race, humans=self.humans) if policies is None else policies
        self.human_actions = human_actions or {}
        self.every = max(1, round(D.DECIDE_EVERY_S / self.race.dt))
        start = {}
        for tid, pol in self.policies.items():             # also sets up each AI car's strategy plan
            for a in pol.start_tyres(project(self.race, tid), {}):
                start[a.car] = a.compound
        start.update(start_tyres or {})                    # recorded choices win over the AI's
        for cid in self.human_cars:                       # a human car with no recorded choice gets the usual medium
            start.setdefault(cid, "MEDIUM")
        start_race(self.race, start)

    @classmethod
    def from_log(cls, bundle, log):
        """Rebuild a recorded race: AI teams run live, the human teams' recorded actions are injected at their ticks (and, for a
        seat that went to the autopilot and back, the hand-overs)."""
        h = log.header
        lights_out = next(e for e in log.events if e["type"] == "lights_out")["payload"]
        cars = tuple(h.get("human_cars", ()))
        owner = car_teams(bundle)
        humans = {}
        for c in cars:
            humans.setdefault(owner[c], []).append(c)
        actions = {}
        for e in human_action_events(log.events, cars, owner):
            actions.setdefault(e["tick"], []).append(action_from_payload(e["payload"]))
        return cls(bundle, h["setup"], human_actions=actions, start_tyres=lights_out["start_tyres"],
                   human_team=h.get("human_team"), human_cars=cars, humans=humans)

    @classmethod
    def from_live(cls, bundle, setup, race, policies, humans):
        """An independent copy of a race that is being run elsewhere (a room's), at its current tick, ready to branch. The race and the
        policies are the room's own; nothing of them is shared with the copy."""
        r = cls.__new__(cls)
        r.bundle, r.setup, r.race, r.policies = bundle, dict(setup), race, policies
        r.humans = {t: tuple(c) for t, c in humans.items()}
        r.human_cars = tuple(c for cars in r.humans.values() for c in cars)
        r.human_team = next(iter(r.humans)) if len(r.humans) == 1 else None
        r.human_actions = {}
        r.every = max(1, round(D.DECIDE_EVERY_S / race.dt))
        return r.copy()

    def hand_to_ai(self, car_ids=None, drop_recorded=True):
        """Let the rule-based AI drive the human cars (all of them, or `car_ids`) from now on, with a plan made from their current
        state. Their recorded actions are dropped (unless `drop_recorded` is false); the other human cars keep theirs."""
        adopt_cars(self.race, self.policies, car_ids if car_ids is not None else self.human_cars)
        if not drop_recorded:
            return
        if car_ids is None:
            self.human_actions = {}
        else:
            gone = set(car_ids)
            self.human_actions = {t: kept for t, acts in self.human_actions.items()
                                  if (kept := [a for a in acts if getattr(a, "car", None) not in gone])}

    def _seat(self, note):
        """A recorded autopilot hand-over or return, applied as the room did: the AI plans the cars, or leaves them to their player."""
        cars = self.humans.get(note.team, ())
        if note.state == "auto":
            self.hand_to_ai(list(cars), drop_recorded=False)       # what the player does after coming back is still to be replayed
        else:
            self.policies[note.team].exclude |= set(cars)

    def reseed_future(self, seed):
        """Another future from now on: new draws for the race and for the AI's own random choices (plans are kept)."""
        redraw_future(self.race, seed)
        for pol in self.policies.values():
            pol.seed = seed
            pol.draws.clear()

    def step(self, extra=()):
        """One tick. `extra` are actions applied before the recorded human ones of this tick (used for what-ifs)."""
        race = self.race
        acts = list(extra) + list(self.human_actions.get(race.tick, ()))
        for a in acts:
            if isinstance(a, SeatNote):
                self._seat(a)
        if race.tick % self.every == 0:
            for tid, pol in self.policies.items():
                acts += pol.decide(project(race, tid), {})
        ev = tick(race, acts)
        if race.tick >= len(race.draws["safety_u"]):
            raise RuntimeError("race ran past the pre-drawn random numbers")
        return ev

    def run_to_end(self, on_tick=None):
        while self.race.session != "FINISHED":
            self.step()
            if on_tick:
                on_tick(self.race)
        return self.race

    def copy(self):
        """An independent copy at this tick. The bundle and the (never written) draws are shared, the event list is dropped."""
        memo = {id(self.bundle): self.bundle, id(self.race.draws): self.race.draws, id(self.race.bundle): self.race.bundle}
        events, self.race.events = self.race.events, []
        try:
            other = copy.deepcopy(self, memo)
        finally:
            self.race.events = events
        return other
