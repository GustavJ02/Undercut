"""FastAPI adapter around `server.room.Room`: HTTP to set up a race, one WebSocket per team to play it.

    venv/bin/uvicorn server.app:app --port 8000        # then open http://localhost:8000 after `npm run build` in client/

The adapter owns real time (the room's `advance` is told how many seconds passed) and moves messages; every rule lives in
the room, the protocol module and the engine. A client sees only `project(...)` of its own team and filtered events.
"""
import asyncio
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine.bundle import load_bundle
from concurrent.futures import ProcessPoolExecutor

from scoring.debrief import DEFAULT_FUTURES, DebriefError, _lower_priority, run_debrief_all
from scoring.live import LiveDebrief
from server import stats
from server.mods import mod_roots, pack_bundle, resolve_mod_file, scan_mods
from server.paths import default_bundle, default_log_dir, resource_root
from server.protocol import ProtocolError, clock_message
from server.room import Room

ROOT = resource_root()


def _bundle_path() -> Path:
    """UNDERCUT_BUNDLE names a bundle file; UNDERCUT_PACK_BUNDLE names a content pack that carries one; otherwise the built-in bundle."""
    if os.environ.get("UNDERCUT_BUNDLE"):
        return Path(os.environ["UNDERCUT_BUNDLE"])
    if os.environ.get("UNDERCUT_PACK_BUNDLE"):
        found = pack_bundle(os.environ["UNDERCUT_PACK_BUNDLE"])
        if found is None:
            raise SystemExit(f"UNDERCUT_PACK_BUNDLE: no bundle.json in a pack folder called {os.environ['UNDERCUT_PACK_BUNDLE']!r}")
        return found
    return default_bundle()


BUNDLE_PATH = _bundle_path()
LOG_DIR = Path(os.environ.get("UNDERCUT_LOGS", default_log_dir()))
TICK_LOOP_S = 0.1
ROOM_TTL_S = float(os.environ.get("UNDERCUT_ROOM_TTL_S", 3600))      # a room nobody is connected to is forgotten after this long
FINISHED_ROOM_TTL_S = float(os.environ.get("UNDERCUT_FINISHED_ROOM_TTL_S", 600))      # a finished race nobody is connected to: only the result and the debrief are left to see, so a shorter wait
LIVE_DEBRIEF = os.environ.get("UNDERCUT_LIVE_DEBRIEF", "1") != "0"      # compute the debrief while the race runs (one decision at a time, as it is made)
DEBRIEF_WORKERS = int(os.environ.get("UNDERCUT_DEBRIEF_WORKERS", max(1, min((os.cpu_count() or 2) - 2, 12))))      # workers run niced, so the live race keeps its clock


CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"        # no 0/O, 1/I/L: a code is read out loud or typed from a message
MAX_ROOMS = int(os.environ.get("UNDERCUT_MAX_ROOMS", 20))


class NewGame(BaseModel):
    """A multiplayer game: the creator is the host and takes `team`; friends join with the code."""
    team: str
    name: str = ""
    circuit: str | None = None
    seed: int = Field(default_factory=lambda: secrets.randbelow(2**31))
    laps: int | None = Field(default=None, ge=2, le=100)
    cars_controlled: int = Field(default=2, ge=1, le=2)
    weather: str = "dry"
    incident_multipliers: dict = Field(default_factory=dict)


class JoinGame(BaseModel):
    team: str
    name: str = ""


class NewRace(BaseModel):
    team: str
    circuit: str | None = None
    seed: int = Field(default_factory=lambda: secrets.randbelow(2**31))
    laps: int | None = Field(default=None, ge=2, le=100)
    cars_controlled: int = Field(default=2, ge=1, le=2)
    speed: int = 1
    pause_allowed: bool = True
    weather: str = "dry"
    incident_multipliers: dict = Field(default_factory=dict)


def create_app(bundle_path=BUNDLE_PATH, log_dir=LOG_DIR, time_scale=1.0, room_ttl_s=ROOM_TTL_S, finished_room_ttl_s=FINISHED_ROOM_TTL_S, mods=None,
               live_debrief=LIVE_DEBRIEF) -> FastAPI:
    """`time_scale` speeds real time up for tests only."""
    app = FastAPI(title="Undercut")
    bundle = load_bundle(bundle_path)
    rooms: dict[str, Room] = {}
    sockets: dict[str, dict] = {}                    # room id -> {websocket: team id}
    tasks: dict[str, asyncio.Task] = {}
    debriefs: dict[str, dict] = {}                   # room id -> {"status", "progress", "reports" (team -> report) | "error"}
    pool: dict = {}                                  # the process pool of every debrief: made when the first race needs it

    def get_pool():
        if "p" not in pool and DEBRIEF_WORKERS > 0:
            pool["p"] = ProcessPoolExecutor(max_workers=DEBRIEF_WORKERS, initializer=_lower_priority)
        return pool.get("p")

    def attach_live(room):
        if live_debrief:
            room.live = LiveDebrief(bundle, get_pool(), DEFAULT_FUTURES)
    busy: dict[str, float] = {}                      # room id -> share of wall time spent stepping the race and sending (smoothed)
    started = time.time()

    @app.on_event("startup")
    async def write_stats():
        if stats.STATS_PATH:
            app.state.stats_task = asyncio.create_task(stats.write_loop(
                stats.STATS_PATH, lambda: stats.snapshot(rooms, sockets, debriefs, busy, started, MAX_ROOMS, DEBRIEF_WORKERS)))

    @app.on_event("shutdown")
    async def stop_stats():
        if getattr(app.state, "stats_task", None):
            app.state.stats_task.cancel()
        for room in rooms.values():
            if room.live:
                room.live.stop()
        if "p" in pool:
            workers = list((getattr(pool["p"], "_processes", None) or {}).values())
            pool["p"].shutdown(wait=False, cancel_futures=True)
            for proc in workers:
                proc.terminate()          # the workers hold the same pipes as the parent, so they never see it go: they would outlive the server and keep its port

    @app.get("/api/options")
    def options():
        return {"bundle_version": bundle["bundle_version"], "circuits": {c: v["total_laps"] for c, v in bundle["circuits"].items()},
                "teams": [{"id": t["id"], "name": t["name"], "drivers": [{"id": d["id"], "name": d["name"]} for d in t["drivers"]]}
                          for t in bundle["teams"]], "speeds": [1, 2, 5, 10],
                "circuit_info": {c: {"lap_length_m": v["lap_length_m"], "corners": len(v["corners"]), "sc_rate_per_lap": round(v["sc_rate_per_lap"], 4)}
                                 for c, v in bundle["circuits"].items()}}

    def check_setup(req):
        if req.team not in {t["id"] for t in bundle["teams"]}:
            raise HTTPException(422, f"unknown team {req.team!r}")
        if req.circuit is not None and req.circuit not in bundle["circuits"]:
            raise HTTPException(422, f"unknown circuit {req.circuit!r}")
        bad = {k: v for k, v in req.incident_multipliers.items() if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 10}
        if bad:
            raise HTTPException(422, f"incident multipliers must be numbers from 0 to 10: {sorted(bad)}")
        if req.weather not in ("dry", "realistic", "wet_start", "rain_during"):
            raise HTTPException(422, "weather must be dry, realistic, wet_start or rain_during")
        if len(rooms) >= MAX_ROOMS:
            raise HTTPException(429, "too many games running on this server")
        return {"seed": req.seed, "circuit": req.circuit, "laps": req.laps, "incident_multipliers": req.incident_multipliers,
                "weather": req.weather}

    def new_code():
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
            if code not in rooms:
                return code

    @app.post("/api/games")
    async def new_game(req: NewGame):
        setup = check_setup(req)
        code = new_code()
        try:
            room = Room(code, bundle, setup, human_team=req.team, cars_controlled=req.cars_controlled, log_dir=log_dir,
                        multiplayer=True, host_name=req.name)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        attach_live(room)
        rooms[code], sockets[code] = room, {}
        tasks[code] = asyncio.create_task(run_room(code))
        return {**room.info(req.team), "team": req.team, "seat": room.humans[req.team]["token"]}

    def game(code):
        room = rooms.get(code.upper())
        if room is None or not room.multiplayer:
            raise HTTPException(404, "no such game: check the code")
        return room

    @app.get("/api/games/{code}")
    def game_info(code: str):
        return game(code).info()

    @app.post("/api/games/{code}/join")
    async def join_game(code: str, req: JoinGame):
        room = game(code)
        try:
            token = room.claim(req.team, req.name)
        except ProtocolError as e:
            raise HTTPException(409, str(e)) from e
        return {**room.info(req.team), "team": req.team, "seat": token}

    @app.post("/api/races")
    async def new_race(req: NewRace):
        if req.team not in {t["id"] for t in bundle["teams"]}:
            raise HTTPException(422, f"unknown team {req.team!r}")
        if req.circuit is not None and req.circuit not in bundle["circuits"]:
            raise HTTPException(422, f"unknown circuit {req.circuit!r}")
        bad = {k: v for k, v in req.incident_multipliers.items() if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 10}
        if bad:
            raise HTTPException(422, f"incident multipliers must be numbers from 0 to 10: {sorted(bad)}")
        if req.speed not in (1, 2, 5, 10):
            raise HTTPException(422, "speed must be 1, 2, 5 or 10")
        room_id = secrets.token_urlsafe(6)
        if req.weather not in ("dry", "realistic", "wet_start", "rain_during"):
            raise HTTPException(422, "weather must be dry, realistic, wet_start or rain_during")
        setup = {"seed": req.seed, "circuit": req.circuit, "laps": req.laps, "incident_multipliers": req.incident_multipliers,
                 "weather": req.weather}
        try:
            room = Room(room_id, bundle, setup, human_team=req.team, cars_controlled=req.cars_controlled, speed=req.speed,
                        pause_allowed=req.pause_allowed, log_dir=log_dir)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        attach_live(room)
        rooms[room_id], sockets[room_id] = room, {}
        tasks[room_id] = asyncio.create_task(run_room(room_id))
        return room.info()

    @app.get("/api/races/{room_id}")
    def race_info(room_id: str):
        if room_id not in rooms:
            raise HTTPException(404, "no such race")
        return rooms[room_id].info()

    async def compute_debrief(room_id, futures=DEFAULT_FUTURES):
        """Make every human team's debrief: from the live computation if the race ran with one, else from the finished log."""
        room, job = rooms[room_id], debriefs[room_id]

        def progress(i, n):
            job["progress"] = [i, n]
        try:
            reports = None
            if room.live is not None and room.live.ok:
                try:
                    reports = await asyncio.to_thread(room.live.reports)
                except DebriefError:
                    reports = None                                   # the live run failed: the log still has everything
            if reports is None:
                reports = await asyncio.to_thread(run_debrief_all, bundle, room.log, futures, DEBRIEF_WORKERS, progress, None, get_pool())
            job.update(status="done", reports=reports)
            if log_dir:
                Path(log_dir).mkdir(parents=True, exist_ok=True)
                (Path(log_dir) / f"{room_id}.debrief.json").write_text(json.dumps(next(iter(reports.values())) if len(reports) == 1 else reports, default=float))
        except DebriefError as e:
            job.update(status="error", error=str(e))
        except Exception as e:  # noqa: BLE001  report any failure to the client instead of losing it in the task
            job.update(status="error", error=f"{type(e).__name__}: {e}")

    def ensure_debrief(room_id, futures=DEFAULT_FUTURES):
        if room_id not in debriefs:
            debriefs[room_id] = {"status": "running", "progress": [0, 0]}
            asyncio.create_task(compute_debrief(room_id, futures))
        return debriefs[room_id]

    def debrief_state(room_id):
        """The job, with the live progress filled in while it runs."""
        room, job = rooms[room_id], debriefs[room_id]
        if job["status"] == "running" and room.live is not None and room.live.ok:
            job["progress"] = room.live.progress()
        return job

    @app.post("/api/races/{room_id}/debrief")
    async def start_debrief(room_id: str, futures: int = DEFAULT_FUTURES):
        room = rooms.get(room_id)
        if room is None:
            raise HTTPException(404, "no such race")
        if room.multiplayer:
            raise HTTPException(409, "a multiplayer race has one debrief per player: ask the game for yours")
        if room.race.session != "FINISHED":                # counterfactuals reveal hidden pace and tyre data
            raise HTTPException(409, "the debrief is only available once the race has finished")
        if not 2 <= futures <= 200:
            raise HTTPException(422, "futures must be between 2 and 200")
        return {"status": ensure_debrief(room_id, futures)["status"]}

    @app.get("/api/races/{room_id}/debrief")
    def get_debrief(room_id: str):
        if room_id not in rooms:
            raise HTTPException(404, "no such race")
        if rooms[room_id].race.session != "FINISHED":
            raise HTTPException(409, "the debrief is only available once the race has finished")
        if room_id not in debriefs:
            return {"status": "not started"}
        job = debrief_state(room_id)
        if job["status"] == "done":
            return {"status": "done", "report": next(iter(job["reports"].values()))}
        return {k: v for k, v in job.items() if k != "reports"}

    def finished_game(code):
        room = game(code)
        if room.race.session != "FINISHED":
            raise HTTPException(409, "the results come once the race has finished")
        return room

    @app.get("/api/games/{code}/ranking")
    def game_ranking(code: str):
        """The strategists of a finished multiplayer game, best first: each one's score out of 100, from their own calls."""
        room = finished_game(code)
        job = debrief_state(room.id) if room.id in debriefs else ensure_debrief(room.id)
        if job["status"] != "done":
            return {k: v for k, v in job.items() if k != "reports"}
        rows = []
        for team, r in job["reports"].items():
            s = r["summary"]
            rows.append({"team": team, "name": room.humans[team]["name"], "score": round(s["score"], 1), "score_low": round(s["score_low"], 1),
                         "score_high": round(s["score_high"], 1), "skill_places": s["skill_places"] - s["penalty_places"], "skill_points": s["skill_points"] - s["penalty_points"],
                         "actual_position": s["actual_position"], "actual_points": s["actual_points"], "cars": r["cars"]})
        rows.sort(key=lambda x: (-x["score"], x["actual_position"], x["team"]))
        return {"status": "done", "ranking": rows, "winner": rows[0]["team"] if rows else None}

    @app.get("/api/games/{code}/debrief")
    def game_debrief(code: str, team: str, seat: str = ""):
        """A player's own detailed debrief, for the seat they hold."""
        room = finished_game(code)
        if not room.seat_ok(team, seat):
            raise HTTPException(403, "this seat is not yours")
        job = debrief_state(room.id) if room.id in debriefs else ensure_debrief(room.id)
        if job["status"] != "done":
            return {k: v for k, v in job.items() if k != "reports"}
        return {"status": "done", "report": job["reports"][team]}

    async def broadcast(room_id, events, force_state):
        room = rooms[room_id]
        for ws, team in list(sockets[room_id].items()):
            try:
                if events or force_state:
                    await ws.send_json({"type": "state", "view": room.view(team)})
                for e in room.events_for(team, events):
                    await ws.send_json({"type": "event", "event": e})
                await ws.send_json(clock_message(room))
            except Exception:  # noqa: BLE001  a dead socket must not stop the race
                sockets[room_id].pop(ws, None)

    async def run_room(room_id):
        room, last, idle, empty_since, finished_since = rooms[room_id], time.monotonic(), 0.0, None, None
        while True:
            await asyncio.sleep(TICK_LOOP_S)
            now = time.monotonic()
            work = time.perf_counter()
            tick_before = room.race.tick
            events = room.advance((now - last) * time_scale)
            last = now
            moved = room.race.tick != tick_before          # push the state after every step, not only when something happened
            idle = idle + TICK_LOOP_S if not (events or moved) else 0.0
            if events or moved or idle >= 1.0:
                await broadcast(room_id, events, force_state=True)
                idle = 0.0
            busy[room_id] = 0.9 * busy.get(room_id, 0.0) + 0.1 * (time.perf_counter() - work) / TICK_LOOP_S
            if sockets[room_id]:
                empty_since = None
            elif empty_since is None:
                empty_since = now
            if finished_since is None and room.race.session == "FINISHED":
                finished_since = now
                if room.live is not None and room.live.ok:
                    ensure_debrief(room_id)                  # the last branches are the only ones left: the result is ready when someone asks
            # nobody has been connected for a while: free the race's memory. A finished race is only waiting to be looked at, so it goes
            # sooner, counted from the later of the finish and the last person leaving (a dropped player has a few minutes to come back).
            if empty_since is not None and sockets[room_id] == {}:
                waited = now - (empty_since if finished_since is None else max(empty_since, finished_since))
                if waited > (room_ttl_s if finished_since is None else min(finished_room_ttl_s, room_ttl_s)):
                    if room.live is not None:
                        room.live.stop()
                    rooms.pop(room_id, None)
                    sockets.pop(room_id, None)
                    tasks.pop(room_id, None)
                    debriefs.pop(room_id, None)
                    busy.pop(room_id, None)
                    break

    @app.websocket("/ws/{room_id}")
    async def play(ws: WebSocket, room_id: str, team: str, seat: str = ""):
        room = rooms.get(room_id) or rooms.get(room_id.upper())
        if room is None or team not in {t["id"] for t in bundle["teams"]}:
            await ws.close(code=4404)
            return
        room_id = room.id
        if room.multiplayer and not room.seat_ok(team, seat):         # a seat is yours only with its secret
            await ws.close(code=4403)
            return
        await ws.accept()
        sockets[room_id][ws] = team
        room.set_connected(team, True)
        await ws.send_json({"type": "snapshot", "info": room.info(team), "view": room.view(team), "clock": clock_message(room),
                            "history": room.history(team), "laps": room.lap_table()})
        try:
            while True:
                try:
                    msg = json.loads(await ws.receive_text())
                    now = room.handle(team, msg) or []                  # radio lines to show at once
                except (ProtocolError, json.JSONDecodeError) as e:
                    await ws.send_json({"type": "error", "message": str(e)})
                else:
                    for e in room.events_for(team, now):
                        await ws.send_json({"type": "event", "event": e})
                    await ws.send_json({"type": "state", "view": room.view(team)})
                    await ws.send_json(clock_message(room))
        except WebSocketDisconnect:
            pass
        finally:
            sockets[room_id].pop(ws, None)
            if team not in sockets[room_id].values():
                room.set_connected(team, False)

    mod_dirs = mods if mods is not None else mod_roots()

    @app.get("/mods/index.json")
    def mods_index():
        """The packs found, for the page's Packs list (the page validates each one when it loads it)."""
        return JSONResponse({"packs": scan_mods(mod_dirs)}, headers={"Cache-Control": "no-store"})

    @app.get("/mods/{source}/{folder}/{rel:path}")
    def mod_file(source: str, folder: str, rel: str):
        status, file, kind = resolve_mod_file(mod_dirs, source, folder, rel)
        if status != 200:
            raise HTTPException(status)
        return FileResponse(file, media_type=kind, headers={"Cache-Control": "no-store"})

    dist = ROOT / "client" / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        if (dist / "packs").is_dir():          # the built-in content pack the page loads
            app.mount("/packs", StaticFiles(directory=dist / "packs"), name="packs")

        @app.get("/")
        def index():
            return FileResponse(dist / "index.html")

        @app.get("/og-image.png")
        def og_image():
            """The preview picture that link cards show (the meta tags in client/index.html)."""
            return FileResponse(dist / "og-image.png", media_type="image/png")

        @app.get("/THIRD_PARTY_NOTICES.txt")
        def notices():
            return FileResponse(dist / "THIRD_PARTY_NOTICES.txt", media_type="text/plain; charset=utf-8")
    return app


app = create_app()
