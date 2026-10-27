"""Helpers that build small synthetic races for the engine tests."""
import copy

from engine.actions import CallBox, SetStartTyres  # noqa: F401
from engine.setup import build_race, start_race
from engine.tick import tick
from tests.bundles import minimal_bundle


def make_bundle(**over):
    b = minimal_bundle()
    b["circuits"]["Test"]["total_laps"] = 10
    b["safety"].update(sc_rate_per_lap=0.0, vsc_rate_per_lap=0.0)
    b["circuits"]["Test"].update(residual_sc_rate_per_lap=0.0, residual_vsc_rate_per_lap=0.0)
    b["start"] = {"grid_gap_s": 0.5, "qualifying_noise_s": 0.0, "qualifying_front_share": 1.0, "reaction_mean_s": 0.0,
                  "reaction_sd_s": 0.0, "launch_tau_s": 0.0, "launch_sd": 0.0, "first_lap_logit_shift": 0.0,
                  "launch_front_share": 1.0}
    b["lap_noise_s"] = 0.0
    for k, v in over.items():
        b[k] = v if not isinstance(v, dict) else {**b[k], **v}
    return copy.deepcopy(b)


def new_race(bundle=None, start="MEDIUM", **setup):
    bundle = bundle or make_bundle()
    race = build_race(bundle, {"seed": 1, **setup})
    start_race(race, {cid: start if isinstance(start, str) else start[cid] for cid in race.grid})
    return race


def run(race, actions_at=None, max_ticks=100000):
    """Run to the end; `actions_at` maps tick -> list of actions (applied before that tick)."""
    actions_at = actions_at or {}
    while race.session != "FINISHED" and race.tick < max_ticks:
        tick(race, actions_at.get(race.tick, ()))
    return race
