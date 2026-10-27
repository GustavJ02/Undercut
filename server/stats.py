"""What the server is doing, for the terminal monitor (`server/monitor.py`).

The server writes a small JSON file once a second when `UNDERCUT_STATS` names a path (the container sets it); the monitor reads it.
A file and not an HTTP route, so nothing about the games is reachable from the internet through a reverse proxy. It holds no secrets:
no seat tokens, no race state, only counts and the public facts of each room.
"""
import asyncio
import json
import os
import time
from pathlib import Path

STATS_PATH = os.environ.get("UNDERCUT_STATS")
WRITE_EVERY_S = 1.0


def snapshot(rooms: dict, sockets: dict, debriefs: dict, busy: dict, started: float, max_rooms: int, debrief_workers: int) -> dict:
    """The counts and one row per room. `busy` is each room's share of wall time spent stepping and sending (0..1)."""
    now = time.time()
    rows = []
    for rid, room in list(rooms.items()):
        race = room.race
        leader = race.cars[race.order()[0]]
        players = room.players() if room.multiplayer else []
        rows.append({
            "id": rid, "kind": "multi" if room.multiplayer else "solo", "circuit": race.circuit_name, "session": race.session,
            "lap": min(max(leader.lap + 1, 1), race.total_laps), "laps": race.total_laps, "speed": room.speed, "paused": room.paused,
            "clients": len(sockets.get(rid, {})), "players": len(players), "players_connected": sum(1 for p in players if p["connected"]),
            "ai_cover": sum(1 for p in players if p["auto"]), "age_s": round(now - room.created, 1), "busy": round(busy.get(rid, 0.0), 4),
            "debrief": debriefs.get(rid, {}).get("status")})
    return {"time": now, "started": started, "max_rooms": max_rooms, "debrief_workers": debrief_workers, "rooms": rows}


async def write_loop(path: str, make) -> None:
    """Write `make()` to `path` every second (atomically: the monitor never reads half a file)."""
    target = Path(path)
    tmp = target.with_name(target.name + ".tmp")
    while True:
        try:
            tmp.write_text(json.dumps(make()))
            os.replace(tmp, target)
        except OSError:
            pass                                      # a full or missing disk must never stop the games
        await asyncio.sleep(WRITE_EVERY_S)
