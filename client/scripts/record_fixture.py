"""Record a short race as the messages a client receives, for the presentation layer's contract and fuzz tests.

Read-only against the backend: it imports `server.room.Room` and plays one race in-process (no server, no port), then writes
under `client/fixtures/` only. Driver names are replaced by "Driver <ID>" so no real name lands in a fixture. Alongside the
messages it writes the hidden numbers of the same race (pace, tyre loss, cliff onset, ...) so a test can prove none of them
reaches the render model.

    venv/bin/python client/scripts/record_fixture.py [--seed 5] [--laps 10] [--circuit austin] [--out client/fixtures]
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from engine.bundle import load_bundle                    # noqa: E402
from engine.state import tyre_loss_s                     # noqa: E402
from server.protocol import clock_message                # noqa: E402
from server.room import Room                             # noqa: E402

HIDDEN_FIELDS = ("pace_s", "pace_now", "lt", "cliff_onset", "damage_s", "stint_s", "launch_at", "launch_tau")


def record(seed=5, laps=10, circuit="austin", team="VMR", every=40, bundle_path=None, out=None):
    bundle = load_bundle(bundle_path or ROOT / "params" / "bundles" / "1.0.0.json")
    room = Room(f"fixture-{seed}", bundle, {"seed": seed, "circuit": circuit, "laps": laps}, human_team=team, speed=10)
    room.handle(team, {"type": "control", "op": "start"})
    info = room.info()
    clean = lambda view: {**view, "cars": [{**c, "driver": f"Driver {c['id']}"} for c in view["cars"]]}    # noqa: E731
    # the snapshot's clock is the full `clock` message, `type` included, exactly as the server sends it
    messages, hidden = [{"type": "snapshot", "info": info, "view": clean(room.view(team)), "clock": clock_message(room), "history": []}], []
    called = set()
    while room.race.session != "FINISHED" and room.race.tick < 200000:
        for cid in sorted(room.human_cars):                       # one early call each, to get acknowledgements and pit events
            car = room.race.cars[cid]
            if cid not in called and car.lap >= 2:
                called.add(cid)
                room.handle(team, {"type": "action", "kind": "CallBox", "car": cid, "compound": "HARD"})
        events = room.advance(room.race.dt)
        for e in room.events_for(team, events):
            messages.append({"type": "event", "event": e})
        if room.race.tick % every == 0 or room.race.session == "FINISHED":
            messages.append({"type": "state", "view": clean(room.view(team))})
            messages.append(clock_message(room))
            hidden.append({cid: {**{f: getattr(c, f) for f in HIDDEN_FIELDS}, "tyre_loss_s": tyre_loss_s(c, room.race)}
                           for cid, c in room.race.cars.items()})
    if out:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        meta = {"seed": seed, "laps": laps, "circuit": circuit, "team": team, "sample_every_ticks": every}
        (out / f"race-{circuit}-{seed}.json").write_text(json.dumps({"meta": meta, "messages": messages}, separators=(",", ":")) + "\n")
        (out / f"race-{circuit}-{seed}.hidden.json").write_text(json.dumps(hidden, separators=(",", ":")) + "\n")
    return messages, hidden


def summary(messages):
    kinds = {}
    for m in messages:
        k = m["event"]["type"] if m["type"] == "event" else m["type"]
        kinds[k] = kinds.get(k, 0) + 1
    return kinds


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--laps", type=int, default=10)
    ap.add_argument("--circuit", default="austin")
    ap.add_argument("--out", default=str(ROOT / "client" / "fixtures"))
    ap.add_argument("--dry", action="store_true", help="print what happened, write nothing")
    a = ap.parse_args()
    msgs, hid = record(a.seed, a.laps, a.circuit, out=None if a.dry else a.out)
    print(a.seed, len(msgs), "messages;", summary(msgs))
