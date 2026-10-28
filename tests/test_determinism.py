import copy
import json
from pathlib import Path

import pytest

from engine.actions import CallBox
from engine.bundle import load_bundle
from engine.race import replay, run_race
from tests.helpers import make_bundle

BUNDLE = Path(__file__).resolve().parent.parent / "params" / "bundles" / "1.0.0.json"
SETUP = {"seed": 11, "laps": 20, "circuit": "austin"}
# Golden digest of the event log for the setup above. It changes whenever engine behaviour changes; update it only on
# purpose, with a decision-log note saying why the physics changed. (Moving the circuits into their own folders changed only the
# bundle hash in the log header: the events are identical. Renaming the teams and drivers changed the random streams, which are
# keyed by car id, so the race itself is a different draw from the same model. Fix B18: this is a 20-lap race, and the AI teams now scale
# their planned stop counts to the share of the full distance, so they make fewer stops here.)
GOLDEN = "6874b62d703a05811c4dd70369a227fc7e0f914aab3a896357c53809b12ae914"


@pytest.fixture(scope="module")
def bundle():
    return load_bundle(BUNDLE)


@pytest.fixture(scope="module")
def baseline(bundle):
    return run_race(bundle, SETUP)


def test_same_seed_gives_an_identical_log_hash(bundle, baseline):
    _, again = run_race(bundle, SETUP)
    assert again.digest() == baseline[1].digest()


def test_a_different_seed_gives_a_different_race(bundle, baseline):
    assert run_race(bundle, {**SETUP, "seed": 12})[1].digest() != baseline[1].digest()


def test_hash_is_stable_across_processes(baseline):
    if GOLDEN is None:
        pytest.skip("golden digest not recorded yet")
    assert baseline[1].digest() == GOLDEN


def test_replay_from_seed_and_actions_reproduces_the_race(bundle, baseline):
    _race, log = baseline
    _again_race, again = replay(bundle, log)
    assert again.digest() == log.digest()
    assert again.events[-1]["payload"]["order"] == log.events[-1]["payload"]["order"]


def test_replay_also_reproduces_a_race_with_injected_human_calls(bundle):
    _race, log = run_race(bundle, SETUP, extra_actions={40: [CallBox("GAN", "HARD")], 900: [CallBox("DUN", "SOFT")]})
    assert any(e["type"] == "action" and e["payload"]["car"] == "GAN" for e in log.events)
    _, again = replay(bundle, log)
    assert again.digest() == log.digest()


def test_log_round_trips_through_a_file(tmp_path, baseline):
    path = tmp_path / "race.jsonl"
    baseline[1].write(path)
    lines = path.read_text().splitlines()
    assert "engine_version" in json.loads(lines[0])["header"]
    assert len(lines) == len(baseline[1].events) + 1


def test_isolation_a_far_away_car_is_unaffected_by_another_teams_stop():
    """A pit call for the leader must not change the laps of a car 40+ s behind (no safety car, no traffic between)."""
    b = make_bundle()
    b["teams"] = b["teams"][:2]
    b["teams"][0]["pace_delta_s"] = -15.0
    b["teams"][0]["drivers"][1]["pace_delta_s"] = 15.0
    b["teams"][1]["pace_delta_s"] = 0.0
    b["lap_noise_s"] = 0.5
    b["circuits"]["Test"]["total_laps"] = 6
    _, base = run_race(copy.deepcopy(b), {"seed": 5}, policies={}, start_tyres={i: "MEDIUM" for i in
                       ("T0A", "T0B", "T1A", "T1B")})
    _, alt = run_race(copy.deepcopy(b), {"seed": 5}, policies={}, extra_actions={400: [CallBox("T0A", "HARD")]},
                      start_tyres={i: "MEDIUM" for i in ("T0A", "T0B", "T1A", "T1B")})
    def laps(log, car):
        # up to lap 5: how late the race ends differs, because the stopping leader takes the flag later
        return [e for e in log.events if e["type"] == "lap" and e["payload"]["car"] == car and e["payload"]["lap"] <= 5]
    assert laps(alt, "T1B") == laps(base, "T1B")
    assert laps(alt, "T0A") != laps(base, "T0A")
