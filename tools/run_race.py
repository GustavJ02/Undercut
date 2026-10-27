"""Run an AI-only race headlessly and print a timing screen.

    venv/bin/python tools/run_race.py --seed 3                 # whole race, final classification and race story
    venv/bin/python tools/run_race.py --seed 3 --watch 10      # timing tower every 10 laps
    venv/bin/python tools/run_race.py --seed 3 --log race.jsonl
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.bundle import load_bundle
from engine.race import run_race
from server.visibility import project

DEFAULT_BUNDLE = Path(__file__).resolve().parent.parent / "params" / "bundles" / "1.0.0.json"
LETTER = {"SOFT": "S", "MEDIUM": "M", "HARD": "H"}


def tower(race, view=None):
    view = view or project(race, "")
    out = [f"lap {view['race_lap']}/{view['total_laps']}  {view['session']}  t={view['time_s'] / 60:.1f} min",
           " P  car  tyre  age stops   gap     int"]
    for c in view["cars"]:
        gap = "-" if c["gap_to_leader_s"] == 0 else f"+{c['gap_to_leader_s']:.1f}"
        itv = "" if c["interval_s"] is None else f"+{c['interval_s']:.1f}"
        out.append(f"{c['position']:2d}  {c['id']}   {LETTER[c['compound']]}   {c['tyre_age']:4d}  {c['stops']:3d} {gap:>8} {itv:>7}"
                   + ("  PIT" if c["status"] == "IN_PIT" else ""))
    return "\n".join(out)


def story(log):
    lines = []
    for e in log.events:
        p, minutes = e["payload"], e["tick"] * log.header["dt"] / 60
        if e["type"] == "safety_deployed":
            lines.append(f"  {minutes:5.1f} min  {p['kind']} deployed for about {p['laps']} laps ({p['cause']})")
        elif e["type"] == "safety_ended":
            lines.append(f"  {minutes:5.1f} min  {p['kind']} ends")
    return lines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--laps", type=int)
    ap.add_argument("--watch", type=int, metavar="N", help="print the timing tower every N laps")
    ap.add_argument("--log", type=Path, help="write the event log (JSON lines) here")
    a = ap.parse_args(argv)
    bundle = load_bundle(a.bundle)
    seen = set()

    def watch(race):
        lead = race.cars[race.order()[0]].lap
        if a.watch and lead and lead % a.watch == 0 and lead not in seen and race.session in ("RACING", "SC", "VSC"):
            seen.add(lead)
            print(tower(race), "\n")

    race, log = run_race(bundle, {"seed": a.seed, "laps": a.laps}, on_tick=watch)
    names = {c.id: c.driver for c in race.cars.values()}
    order = log.of_type("classification")[-1]["payload"]["order"]
    print(f"Seed {a.seed}, {race.circuit_name}, {race.total_laps} laps, digest {log.digest()[:12]}\n")
    print(" P  car  driver                stops  tyres      race time")
    win = race.cars[order[0]].finish_t
    for i, cid in enumerate(order, 1):
        c = race.cars[cid]
        t = f"{c.finish_t / 60:8.2f} min" if i == 1 else (f"+{c.finish_t - win:6.1f} s" if c.lap == race.total_laps else f"{c.lap} laps")
        print(f"{i:2d}  {cid}   {names[cid]:20s} {c.stops:4d}   {'-'.join(LETTER[x] for x in c.compounds_used):8s} {t}")
    print(f"\nPasses: {len(log.of_type('pass'))}   Stops: {len(log.of_type('pit_in'))}   "
          f"Safety periods: {len(log.of_type('safety_deployed'))}")
    for line in story(log):
        print(line)
    if a.log:
        log.write(a.log)


if __name__ == "__main__":
    main()
