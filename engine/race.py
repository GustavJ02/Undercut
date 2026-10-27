"""Running a whole race: start tyres from the policies, then ticks with policy decisions every few seconds.

Offline use and tests call `run_race`; the server later drives the same `tick` itself and owns the clock.
"""
import hashlib
import json

from engine.actions import action_from_payload
from engine.eventlog import EventLog
from engine.runner import Runner, make_policies

ENGINE_VERSION = "0.2.0"


def default_policies(bundle, setup, race):
    return make_policies(bundle, race)


def bundle_sha(bundle) -> str:
    """Hash of the bundle's contents: the bundle version number alone does not change when a bundle is regenerated."""
    return hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).hexdigest()[:16]


def header(bundle, setup, race, human_team=None, human_cars=()):
    return {"engine_version": ENGINE_VERSION, "bundle_version": bundle["bundle_version"], "bundle_sha": bundle_sha(bundle),
            "seed": race.seed, "circuit": race.circuit_name, "dt": race.dt, "laps": race.total_laps, "setup": setup,
            "human_team": human_team, "human_cars": sorted(human_cars)}


def run_race(bundle, setup=None, policies=None, extra_actions=None, on_tick=None, start_tyres=None):
    """Run one race to the flag. `policies` maps team id -> Policy (default: rule-based AI for every team);
    `extra_actions` maps tick -> list of actions injected before that tick (a human's calls, or a test's);
    `start_tyres` maps car -> compound and replaces the policies' choice (used by replay). Returns (race, EventLog)."""
    setup = dict(setup or {})
    runner = Runner(bundle, setup, policies=policies, human_actions=extra_actions, start_tyres=start_tyres)
    race = runner.race
    log = EventLog(header(bundle, setup, race))
    runner.run_to_end(on_tick)
    log.extend(race.events)
    return race, log


def replay(bundle, log):
    """Re-run a race from its header and recorded actions only (no live AI). Returns (race, EventLog) with the same header;
    the digest must equal the original's."""
    h = log.header
    lights_out = next(e for e in log.events if e["type"] == "lights_out")["payload"]
    actions = {}
    for e in log.events:
        if e["type"] == "action":
            p = e["payload"]
            actions.setdefault(e["tick"], []).append(action_from_payload(p))
    runner = Runner(bundle, h["setup"], policies={}, human_actions=actions, start_tyres=lights_out["start_tyres"])
    out = EventLog(h)
    runner.run_to_end()
    out.extend(runner.race.events)
    return runner.race, out
