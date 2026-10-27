"""Run the built executable and play a short race through it: the check that the packaged app really works.

    venv/bin/python packaging/smoke_test.py [packaging/dist/undercut]

Starts the app without a browser on a free port with a private data folder, creates a 3-lap race over HTTP, plays it to the
flag over a WebSocket, asks for the debrief, and checks that a race log was written to the data folder.
"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent


def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


def post(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


async def play(port, room_id, team):
    async with websockets.connect(f"ws://127.0.0.1:{port}/ws/{room_id}?team={team}") as ws:
        await ws.send(json.dumps({"type": "control", "op": "start"}))
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), 60))
            if m["type"] == "event" and m["event"]["type"] == "classification":
                return


def main():
    exe = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "packaging" / "dist" / "undercut")
    assert exe.exists(), f"{exe} not found: run packaging/build.sh first"
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    with tempfile.TemporaryDirectory() as data:
        env = {**os.environ, "UNDERCUT_DATA": data}
        proc = subprocess.Popen([str(exe), "--port", str(port), "--no-browser"], env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
        try:
            for _ in range(150):
                try:
                    options = get(f"http://127.0.0.1:{port}/api/options")
                    break
                except OSError:
                    if proc.poll() is not None:
                        raise SystemExit(f"the app exited early:\n{proc.stdout.read().decode()}") from None
                    time.sleep(0.2)
            else:
                raise SystemExit("the app did not start")
            team = options["teams"][0]["id"]
            page = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5).read()
            assert b"<div id=\"root\">" in page, "the web client is missing from the app"
            packs = get(f"http://127.0.0.1:{port}/mods/index.json")["packs"]
            example = next((p for p in packs if p["source"] == "examples" and p["ok"]), None)
            assert example, f"the example content pack is missing from the app: {packs}"
            get(f"http://127.0.0.1:{port}{example['root']}/manifest.json")
            room = post(f"http://127.0.0.1:{port}/api/races", {"team": team, "circuit": "austin", "laps": 3, "speed": 10})
            asyncio.run(play(port, room["id"], team))
            post(f"http://127.0.0.1:{port}/api/races/{room['id']}/debrief?futures=2")
            for _ in range(300):
                d = get(f"http://127.0.0.1:{port}/api/races/{room['id']}/debrief")
                if d["status"] != "running":
                    break
                time.sleep(0.5)
            assert d["status"] == "done", d
            logs = list((Path(data) / "logs").glob("*.jsonl"))
            assert logs, "no race log was written to the data folder"
            print(f"OK: played a race and a debrief through {exe.name}; log {logs[0].name}")
        finally:
            proc.terminate()
            proc.wait(10)


if __name__ == "__main__":
    main()
