import copy
import json
from itertools import pairwise
from pathlib import Path

import pytest

from engine.bundle import load_bundle
from engine.race import run_race
from engine.state import COMPOUNDS
from server.visibility import project, visible_numbers
from tests.helpers import make_bundle, new_race, run

BUNDLE = Path(__file__).resolve().parent.parent / "params" / "bundles" / "1.0.0.json"
HIDDEN_KEYS = {"cliff_onset", "pace_s", "lt", "progress", "draws", "pit", "tyre_loss_s", "base_lap_s"}


@pytest.fixture(scope="module")
def bundle():
    return load_bundle(BUNDLE)


def check(race):
    if race.session != "GRID":                         # the published order never ranks a car ahead of one that has covered more
        dist = [float(c.lap) if c.status == "FINISHED" else c.progress for c in (race.cars[i] for i in race.order())
                if c.status != "RETIRED"]
        assert all(x >= y - 1e-9 for x, y in zip(dist, dist[1:]))
    running = sorted((c for c in race.cars.values() if c.status == "RUNNING"), key=lambda c: -c.progress)
    for a, b in pairwise(running):
        assert a.progress > b.progress, (a.id, b.id)
    for c in race.cars.values():
        assert all(n >= 0 for n in c.sets.values()), (c.id, c.sets)
        assert c.age >= 0 and c.compound in COMPOUNDS
        assert c.progress >= -1.0


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_invariants_hold_every_tick_of_a_full_ai_race(bundle, seed):
    race, log = run_race(bundle, {"seed": seed, "laps": 25}, on_tick=check)
    assert race.session == "FINISHED"
    assert all(c.status in ("FINISHED", "RETIRED") for c in race.cars.values())
    order = log.events[-1]["payload"]["order"]
    assert sorted(order) == sorted(race.cars)


@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_ai_teams_use_two_compounds_and_only_sets_they_have(bundle, seed):
    race, log = run_race(bundle, {"seed": seed, "laps": 30})
    assert not log.of_type("penalty"), [e["payload"] for e in log.of_type("penalty")]
    assert not [e for e in log.events if e["type"] == "box_ack" and not e["payload"]["ok"] and "no " in e["payload"]["message"]]
    for c in race.cars.values():
        if c.status == "FINISHED":
            assert len(set(c.compounds_used)) >= 2


def test_visible_state_holds_no_hidden_field_or_value(bundle):
    """Fuzz: for several seeds and moments, serialised views contain no hidden keys and no hidden number of other teams."""
    for seed in (1, 2):
        views = []
        def grab(race, views=views):
            if race.tick % 400 == 0:
                views.append((copy.copy(race.tick), {t["id"]: project(race, t["id"]) for t in race.bundle["teams"][:3]},
                              {c.id: (c.cliff_onset, c.pace_s, c.lt) for c in race.cars.values()}))
        race, _ = run_race(bundle, {"seed": seed, "laps": 12}, on_tick=grab)
        assert views
        for tick_, by_team, hidden in views:
            for team, view in by_team.items():
                text = json.dumps(view)
                assert not (HIDDEN_KEYS & set(_all_keys(view))), HIDDEN_KEYS & set(_all_keys(view))
                numbers = {round(x, 6) for x in visible_numbers(view)}
                for cid, vals in hidden.items():
                    if race.cars[cid].team == team:
                        continue
                    for v in vals:
                        assert round(v, 6) not in numbers or v == 0, (tick_, cid, v)
                assert "est_tyre_loss_s" in text and all(
                    cid in view["own"] for cid in race.cars if race.cars[cid].team == team)
                assert not any(cid in view["own"] for cid in race.cars if race.cars[cid].team != team)


def _all_keys(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(x, list):
        for v in x:
            yield from _all_keys(v)


def test_a_cliff_makes_staying_out_lose_to_the_baseline_stop():
    """What the cliff is for (advisor check): without it a no-stop race wins; with it, stopping must win."""
    def total_time(extra, stop):
        b = make_bundle()
        b["teams"] = b["teams"][:1]
        b["circuits"]["Test"]["total_laps"] = 30
        for c in b["compounds"].values():
            c["wear_s_per_lap"] = 0.05
            c["cliff"].update(onset_age=[12, 12], onset_cdf=[0.0, 1.0], extra_s_per_lap=extra)
        b["pit_stop"].update(stationary_sd_s=0.0, slow_stop_prob=0.0, error_prob=0.0)
        race = new_race(b)
        race.cars["T0B"].status, race.cars["T0B"].retired_t = "RETIRED", 0.0
        from engine.actions import CallBox
        run(race, {2000: [CallBox("T0A", "HARD")]} if stop else {})
        return race.cars["T0A"].finish_t
    assert total_time(0.0, stop=False) < total_time(0.0, stop=True)          # no cliff: never stop
    assert total_time(1.0, stop=True) < total_time(1.0, stop=False)          # with a cliff: stop

