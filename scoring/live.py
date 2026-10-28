"""The debrief, computed while the race runs.

A decision is judged from the race as it stood at that moment and from the player's earlier calls only: what the alternatives would have
done is played on from there, with fresh luck, by the default strategy (see `scoring/debrief.py`). Nothing about the rest of the real race
is needed, so each decision can be sent to the workers as soon as it is made, and what is left to do at the flag is the last few short
branches and the luck figure. The numbers are exactly the ones the debrief of the finished race gives (a test holds the two to that).

The room calls `begin` at the lights, `take` where a decision may come (before a tick that applies a human call, and when a safety car
comes out: the race is copied there) and `after_tick` with each tick's events. The copying is done at once, on the room's thread; the
rest happens on a thread of its own, which reads the room's event list as it grows and sends each settled decision's alternatives to the
process pool. A safety-car "stay out" is settled only when the period ends (a car that pitted in it made a call instead).
"""
import queue
import threading

from engine.runner import Runner, car_teams
from scoring.debrief import (DEFAULT_FUTURES, DebriefError, _gather, _options, _seeds, _submit, build_report, decision_arms, default_start,
                             final_order, human_decisions)

KIND_ORDER = {"start": 0, "call": 1, "swap": 2, "safety": 3}
KEEP_TICKS = 60            # a copy of the race that no decision has asked for after this many ticks was for a call that was refused


class LogView:
    """What the debrief functions read of a log: a header and the events so far."""

    def __init__(self, header, events):
        self.header, self.events = header, events


class LiveDebrief:
    def __init__(self, bundle, executor=None, futures=DEFAULT_FUTURES):
        self.bundle, self.executor, self.futures = bundle, executor, futures
        self.header = self.events = self.setup = None
        self.roster, self.owner, self.multi = {}, {}, False
        self.snaps = {}                       # tick -> an independent copy of the race at that tick
        self.jobs, self.counted, self.seen, self.defaults = {}, {}, set(), {}
        self.failed = None
        self.finished = False
        self._q = queue.Queue()
        self._thread = None
        self._seeds = _seeds

    # -- called by the room, on its own thread --------------------------------------------------------------------
    def begin(self, room):
        """The lights are out: note who plays, and start on the start-tyre decisions."""
        self.header, self.events, self.setup = dict(room.log.header), room.race.events, dict(room.setup)
        self.owner = car_teams(self.bundle)
        for c in self.header["human_cars"]:
            self.roster.setdefault(self.owner[c], []).append(c)
        self.roster = {t: sorted(cs) for t, cs in self.roster.items()}
        self.multi = len(self.roster) > 1
        self.jobs, self.counted = {t: [] for t in self.roster}, {t: [] for t in self.roster}
        self.seeds = self._seeds(self.header["seed"], self.futures)
        self.take(room)
        self._thread = threading.Thread(target=self._loop, name="live-debrief", daemon=True)
        self._thread.start()
        self._q.put(("check", len(self.events), False))

    def take(self, room):
        """Copy the race as it is now, unless that has been done for this tick."""
        tick = room.race.tick
        if self.failed or tick in self.snaps:
            return
        try:
            humans = {t: sorted(h["cars"]) for t, h in room.humans.items()}
            self.snaps[tick] = Runner.from_live(self.bundle, self.setup, room.race, room.policies, humans)
        except Exception as e:  # noqa: BLE001  a debrief that cannot be had live is made after the race
            self.failed = f"{type(e).__name__}: {e}"

    def after_tick(self, room, events):
        """A tick is done: look for decisions if it produced anything that makes or settles one."""
        if self.header is None:
            return
        finished = room.race.session == "FINISHED"
        kinds = {e["type"] for e in events}
        if "safety_deployed" in kinds:
            self.take(room)
        if finished or kinds & {"box_ack", "swap_ack", "safety_ended", "safety_deployed"}:
            self._q.put(("check", len(self.events), finished))

    # -- the worker thread -----------------------------------------------------------------------------------------
    def _loop(self):
        while True:
            item = self._q.get()
            try:
                if item[0] == "stop":
                    return
                if not self.failed:
                    self._check(item[1], item[2])
            except Exception as e:  # noqa: BLE001
                self.failed = f"{type(e).__name__}: {e}"
            finally:
                self._q.task_done()

    def _check(self, n_events, finished):
        events = self.events[:n_events]
        log = LogView(self.header, events)
        if not self.defaults:
            self.defaults = {t: default_start(self.bundle, log, cs) for t, cs in self.roster.items()}
        ended = [e["tick"] for e in events if e["type"] == "safety_ended"]
        new = []
        for team, cars in self.roster.items():
            for d in human_decisions(log, cars, self.owner if self.multi else None):
                key = (team, d["tick"], d["kind"], d["car"], repr(d["taken"]))
                if key in self.seen:
                    continue
                if d["kind"] == "safety" and not finished and not any(t > d["tick"] for t in ended):
                    continue                                             # not settled: the car may still pit in the period
                new.append((team, d, key))
        new.sort(key=lambda x: (x[1]["tick"], KIND_ORDER[x[1]["kind"]], x[1]["car"]))
        for team, d, key in new:
            self.seen.add(key)
            self._decide(team, d, log)
        self.finished = self.finished or finished
        horizon = n_events and events[-1]["tick"] - KEEP_TICKS
        held = self._held(events, ended)
        for tick in [t for t in list(self.snaps) if t < horizon and t not in held]:
            self.snaps.pop(tick, None)

    def _held(self, events, ended):
        """Ticks whose copy of the race a safety-car decision still needs: periods that have not ended."""
        deployed = [e["tick"] for e in events if e["type"] == "safety_deployed"]
        return {t for t in deployed if not any(x > t for x in ended)}

    def _decide(self, team, d, log):
        runner = self.snaps.get(d["tick"])
        if runner is None:
            raise DebriefError(f"no copy of the race at tick {d['tick']} for a decision of {d['car']}")
        car = runner.race.cars[d["car"]]
        if d["kind"] == "safety" and (car.status != "RUNNING" or car.box_call or d["tick"] == 0
                                      or runner.race.total_laps - car.lap <= 3
                                      or not any(car.sets.get(c, 0) > 0 for c in _options(log, runner))):
            return
        arms = decision_arms(self.bundle, log, runner, d, [e for e in self.counted[team] if e["tick"] == d["tick"]], self.defaults[team])
        if len(arms) < 2:
            return
        self.counted[team].append(d)
        self.jobs[team].append((d, car.lap + 1, arms, _submit({k: (a.blob, a.extra) for k, a in arms.items()}, self.seeds,
                                                               self.roster[team], self.executor)))

    # -- what the caller asks for ------------------------------------------------------------------------------------
    @property
    def ok(self):
        return self.failed is None and self.header is not None

    def progress(self):
        """(branches done, branches started), counted per alternative of each decision made so far."""
        done = total = 0
        for team_jobs in self.jobs.values():
            for _, _, _, pending in list(team_jobs):
                for parts in pending.values():
                    for part in parts:
                        total += 1
                        done += 1 if not hasattr(part, "done") or part.done() else 0
        return [done, total]

    def reports(self):
        """Every team's report, once the race has finished. Waits for the last branches. Raises DebriefError if the live run failed, in
        which case the caller makes the debrief from the log instead."""
        self._q.join()
        if self.failed:
            raise DebriefError(f"the live debrief failed: {self.failed}")
        if not self.finished:
            raise DebriefError("the race has not finished")
        log = LogView(self.header, list(self.events))
        order = final_order(_Final(log.events))
        out = {}
        for team, cars in self.roster.items():
            jobs = sorted(self.jobs[team], key=lambda j: (j[0]["tick"], KIND_ORDER[j[0]["kind"]], j[0]["car"]))
            gathered = [(d, lap, arms, _gather(pending)) for d, lap, arms, pending in jobs]
            out[team] = build_report(log, team, cars, self.futures, gathered, order, marginal=self.multi)
        return out

    def stop(self):
        """Drop what is waiting: the room is gone."""
        self.failed = self.failed or "stopped"
        for team_jobs in self.jobs.values():
            for _, _, _, pending in team_jobs:
                for parts in pending.values():
                    for part in parts:
                        if hasattr(part, "cancel"):
                            part.cancel()
        self._q.put(("stop",))


class _Final:
    """`final_order` reads `race.events`: this lets it read a plain list."""

    def __init__(self, events):
        self.events = events
