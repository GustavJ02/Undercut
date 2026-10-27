"""A race together with the AI teams that run it, stepped one tick at a time and copyable at any tick.

The same loop as the room's (`server/room.py`): human actions first, then, every few seconds, each AI team looks at its visible
state, then one `tick`. The debrief replays a finished race with this class, copies it at a decision, and plays the copies on
with other actions and other luck (`engine.setup.redraw_future`).
"""
import copy

from engine.actions import action_from_payload
from engine.rivals import defaults as D
from engine.rivals.policy import RulePolicy
from engine.setup import build_race, redraw_future, start_race
from engine.tick import tick
from server.visibility import project


def make_policies(bundle, race, human_team=None, human_cars=()):
    """Rule-based AI for every team; the human cars are left to their player."""
    return {t["id"]: RulePolicy(t["id"], race.seed, bundle, race.circuit_name, race.total_laps,
                                exclude=human_cars if t["id"] == human_team else ())
            for t in bundle["teams"]}


class Runner:
    def __init__(self, bundle, setup, policies=None, human_actions=None, start_tyres=None, human_team=None, human_cars=()):
        self.bundle, self.setup = bundle, dict(setup)
        self.race = build_race(bundle, self.setup)
        self.human_team, self.human_cars = human_team, tuple(human_cars)
        self.policies = make_policies(bundle, self.race, human_team, self.human_cars) if policies is None else policies
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
        """Rebuild a recorded race: AI teams run live, the human team's recorded actions are injected at their ticks."""
        h = log.header
        lights_out = next(e for e in log.events if e["type"] == "lights_out")["payload"]
        cars = tuple(h.get("human_cars", ()))
        actions = {}
        for e in log.events:
            p = e["payload"]
            if e["type"] == "action" and p["car"] in cars:
                actions.setdefault(e["tick"], []).append(action_from_payload(p))
        return cls(bundle, h["setup"], human_actions=actions, start_tyres=lights_out["start_tyres"],
                   human_team=h.get("human_team"), human_cars=cars)

    def hand_to_ai(self, car_ids=None):
        """Let the rule-based AI drive the human cars from now on, with a plan made from their current state."""
        race = self.race
        pol = self.policies.get(self.human_team)
        if pol is None:
            return
        view = project(race, self.human_team)
        rows = {c["id"]: c for c in view["cars"]}
        for cid in (car_ids if car_ids is not None else self.human_cars):
            car = race.cars[cid]
            if car.status != "RUNNING":
                continue
            row = dict(rows[cid])
            call = car.box_call
            if call:                                    # a stop already called is as good as made: the AI plans what comes after it, not a second stop
                sets = dict(row["sets_remaining"])
                sets[call["compound"]] = sets.get(call["compound"], 0) - 1
                row.update(stops=row["stops"] + 1, compound=call["compound"], tyre_age=0, sets_remaining=sets,
                           compounds_used=list(row["compounds_used"]) + [call["compound"]])
            pol.adopt_car(cid, row, race.total_laps - row["lap"], race.tick)
        self.human_actions = {}

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
