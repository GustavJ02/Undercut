"""Debrief a finished race from its event log: what each decision was worth, and luck against skill.

    venv/bin/python tools/debrief.py logs/<race id>.jsonl [--futures 24] [--workers 6] [--json out.json]

Races played in the game are written to logs/<id>.jsonl when they finish. The log must have been run with the bundle that is
loaded now (the header holds its hash); otherwise the race cannot be replayed exactly and nothing is computed.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.bundle import load_bundle
from engine.eventlog import EventLog
from scoring.debrief import DEFAULT_FUTURES, DebriefError, format_report, run_debrief_all

DEFAULT_BUNDLE = Path(__file__).resolve().parent.parent / "params" / "bundles" / "1.0.0.json"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("log", type=Path)
    ap.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    ap.add_argument("--futures", type=int, default=DEFAULT_FUTURES)
    ap.add_argument("--workers", type=int, default=max(1, min((os.cpu_count() or 2) - 2, 12)), help="processes (default: all cores but two, at most 12)")
    ap.add_argument("--team", help="debrief only this team (a multiplayer race has one debrief per human team)")
    ap.add_argument("--json", type=Path, help="also write the full report here (a team's report, or team -> report for several)")
    a = ap.parse_args(argv)
    try:
        reports = run_debrief_all(load_bundle(a.bundle), EventLog.read(a.log), a.futures, a.workers,
                                  progress=lambda i, n: print(f"  decision {i}/{n} done", file=sys.stderr),
                                  teams=[a.team] if a.team else None)
    except DebriefError as e:
        raise SystemExit(f"cannot debrief: {e}") from e
    for report in reports.values():
        print(format_report(report))
        print()
    if a.json:
        one = next(iter(reports.values())) if len(reports) == 1 else reports
        a.json.write_text(json.dumps(one, indent=1, default=float))


if __name__ == "__main__":
    main()
