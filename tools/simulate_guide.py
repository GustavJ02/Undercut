"""Fill each circuit's `simulated_stops`: how many stops cars made in AI-only races of this bundle at the circuit's full distance.

The tyre guide shows these numbers ("N% of simulated races here were one-stoppers"). They are what our own simulation does, not an
input of it: the AI draws its plan from `stops_distribution`, and safety cars, damage, retirements and the two-compound rule move the
result away from that. The outline in each `circuit.json` is copied as the raw text it was read as, so it never changes.

    venv/bin/python tools/simulate_guide.py [--races 30] [--workers 8] [--bundle params/bundles/1.0.0.json]
"""
import argparse
import json
import re
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from engine.bundle import load_bundle
from engine.runner import Runner

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BUNDLE = ROOT / "params" / "bundles" / "1.0.0.json"


def stops_of_one_race(task):
    bundle_path, circuit, seed = task
    runner = Runner(load_bundle(bundle_path), {"seed": seed, "circuit": circuit, "weather": "dry"})
    runner.run_to_end()
    return [c.stops for c in runner.race.cars.values() if c.status == "FINISHED"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--races", type=int, default=30)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    a = ap.parse_args(argv)
    files = sorted((ROOT / "circuits").glob("*/circuit.json"))
    tasks = [(a.bundle, f.parent.name, seed) for f in files for seed in range(1, a.races + 1)]
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        results = list(pool.map(stops_of_one_race, tasks, chunksize=2))
    by_circuit: dict[str, Counter] = {}
    for (_, circuit, _), stops in zip(tasks, results):
        by_circuit.setdefault(circuit, Counter()).update(stops)
    for f in files:
        raw = f.read_text()
        outline = re.search(r'"outline": (\{"points": \[\[.*?\]\]\})', raw, re.S).group(1)
        doc = json.loads(raw)
        counts = by_circuit[f.parent.name]
        doc["parameters"]["simulated_stops"] = {str(k): counts[k] for k in sorted(counts)}
        doc["outline"] = "@@OUTLINE@@"
        text = json.dumps(doc, indent=1, ensure_ascii=False).replace('"@@OUTLINE@@"', outline)
        f.write_text(text + "\n")
        assert json.loads(f.read_text())["outline"] == json.loads(raw)["outline"] and outline in f.read_text()
        print(f"{f.parent.name:18s} {dict(sorted(counts.items()))}")


if __name__ == "__main__":
    main()
