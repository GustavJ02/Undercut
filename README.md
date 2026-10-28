# Undercut

A live, tick-based race strategy game. You run the pit wall: watch timing, gaps and tyres, call the stops and the team
orders, talk to your drivers on the radio, and live with incidents, weather and red flags.
Play alone against AI teams, or with friends who each run a team in the same race. After a race the debrief replays your
decisions against other futures and splits the result into luck and skill.

## Quick start

You need Python 3.13 and Node.js 20 or newer (Debian/Ubuntu: `sudo apt install python3.13 python3.13-venv nodejs npm`).

```
git clone <this repository> Undercut && cd Undercut
python3.13 -m venv venv
venv/bin/pip install -r requirements.txt
cd client && npm install && npm run build && cd ..
venv/bin/python -m server.launcher
```

The last command starts the game on `http://127.0.0.1:8000` and opens your browser. Pick **Singleplayer**, choose a team and a
circuit, set the starting tyres on the grid, press **Lights out**, and call stops from the pit panel. Press Ctrl+C in the terminal
to stop it. Everything the game needs is in the repository (the parameter bundle is `params/bundles/1.0.0.json`, the circuits are in
`circuits/`).

**Play with friends** (one machine runs the game, the others open it in their browsers):

```
venv/bin/python -m server.launcher --lan
```

It prints an address such as `http://192.168.1.20:8000`. You choose **Multiplayer > Create game**, pick a team and read out the
five letter code. Friends open the address, choose **Multiplayer > Join game**, type the code and pick a free team. You start the
race when everyone is in. Teams nobody takes are run by the AI. There is no login: only people who can reach your machine and know
the code can join, so use it on a network you trust. Friends outside your home network need a port forward to port 8000.

**On a server with Docker** (also a Raspberry Pi 5, the image builds for x86-64 and ARM64):

```
docker compose up -d --build
```

The game is then on port 8000 of that machine. Race logs and extra content packs are kept in the `undercut-data` volume
(`/data/logs`, `/data/mods`), so rebuilding the image loses nothing. Edit `docker-compose.yml` to change the host port, the number of
games at once or the CPU limit. `docker compose down` stops it. `./monitor.sh` opens a terminal dashboard inside the container: singleplayer and
multiplayer games running, browsers connected, CPU, memory, network and a row per game (`q` quits; `./monitor.sh --once` prints one snapshot). Put it behind your own firewall or port forward; there is no login.

**Development mode** (the page reloads when you edit the client): run `venv/bin/uvicorn server.app:app --port 8000` in one
terminal and `cd client && npm run dev` in another, then open the address Vite prints.

**Tests:** `venv/bin/pip install -r requirements-dev.txt`, then `venv/bin/pytest` (the fast suite, a few minutes),
`venv/bin/pytest -m slow` (full-length races against plausibility bands, much longer) and `cd client && npm test`.

## What is in the game

- **23 circuits**, each named after its town or region, with the circuit outline and the corner positions on the map.
- **Strategy:** start tyres, pit calls with the compound and the lap, two-compound rule, safety car and VSC, red flags with free
  tyre changes and a standing restart, a hidden tyre cliff you read from noisy estimates, dirty air and passing.
- **Weather:** dry, realistic, wet start or rain during the race, with a forecast, intermediate and wet tyres.
- **Team orders and radio:** swap your two cars as soon as possible or before / after a numbered turn (a driver may argue and
  need the call repeated); drivers report tyres, weather and damage, ask to box or to be let by, and answer questions.
- **Strategist screen:** lap times of every car (with a fuel-corrected view), tyre wear per stint, the pit window and undercut
  threat, and your own telemetry.
- **Debrief:** every decision replayed against 24 alternative futures, with skill and luck told apart, and a strategist score out of 100 (50 = as good as
  the AI would have been with your cars). It is worked out while the race runs, so it is ready at the flag.
- **Chaos mode** scales the rates of collisions, failures, lap-one trouble and safety cars.
- **Multiplayer** over a local network (above). Each player is scored on their own calls; the best strategist wins, and everyone can open
  their own detailed debrief.

Races are written to `logs/<id>.jsonl` and replay exactly. A server nobody is connected to forgets a race after an hour
(`UNDERCUT_ROOM_TTL_S`), and a finished race after ten minutes (`UNDERCUT_FINISHED_ROOM_TTL_S`).

## Mods: content packs

A pack changes how the game looks and sounds (team and driver names, colours, liveries, the people in the pit wall, sounds) and never
the race. See `docs/modding.md`; `mods/examples/` has one to copy. Your own packs go in `mods/local/`, which git ignores, or in the
folder `UNDERCUT_MODS` names. Both the game server and the development server serve them: pick one under Packs in the game. A pack
may also bring its own parameter bundle (`bundle.json`); name the pack in `UNDERCUT_PACK_BUNDLE` to make the server use it.

## Offline app

```
packaging/build.sh                              # builds the client, then one executable: packaging/dist/undercut
venv/bin/python packaging/smoke_test.py         # plays a short race through it
packaging/dist/undercut                         # starts the server on 127.0.0.1 and opens the browser
```

Race logs go to `~/.local/share/undercut/logs`. Building needs Python's shared library (Debian/Ubuntu:
`sudo apt install libpython3.13`). Windows and macOS builds have to be made on those systems.

## How it works

The engine (`engine/`) is a pure, deterministic Python simulator that advances the race by 0.5 s per tick. `setup.py` builds a
race and pre-draws all randomness from keyed streams, `tick.py` advances it, `rivals/` holds the rule-based AI teams, `orders.py`,
`weather.py` and the radio (`server/radio.py`) add team orders, weather and driver talk. `server/visibility.py` is the only path
state takes to a client, so a team never sees hidden pace, tyre or cliff values. The server (`server/`) is a FastAPI app with
a WebSocket per team; the client (`client/`) is React, Three.js and TypeScript. The event log holds the seed, setup, versions and
every action, so a race replays exactly (`engine/runner.py`), and `scoring/debrief.py` builds on that.

Docs: `docs/modding.md` explains how to make a content pack.

### Command line

    venv/bin/python tools/run_race.py --seed 3 --watch 20      # an AI-only race: classification, timing tower every 20 laps
    venv/bin/python tools/debrief.py logs/<race id>.jsonl --futures 24

### The parameter bundle

`params/bundles/1.0.0.json` holds the numbers the simulation uses (tyres, safety cars, incidents, weather, teams), validated against
`params/bundle.schema.json`. It is built by hand with rounded plausible values. Each circuit is one folder in `circuits/<id>/` with
its outline, corner positions and numbers, so a circuit is removed by deleting its folder; the bundle takes its circuits from there.
`venv/bin/python -m tools.simulate_guide` fills each circuit's `simulated_stops` (what the tyre guide reports) by simulating races.

## Release checks

`cd client && npm run build` also checks the built page against a list of terms that must not be in a public build. The list is kept as
hashes (`client/scripts/denylist.sha256`), so it ships without containing what it forbids. `npm run check:tree` runs the same check
over the source tree. `npm run notices` writes the third-party licence notices into the build.

## Disclaimer

See the footer of the game's landing page (`client/src/legal.ts`).

## Licence

Copyright (C) 2026 Gustav Johansson

The code is licensed under the GNU Affero General Public License v3.0; see [LICENSE](LICENSE).
The base content pack (`client/public/packs/base-fictional`) is CC0-1.0.
Third-party libraries keep their own licences; see the third-party notices shipped with the build.
Circuit outlines in `circuits/` are derived from third-party timing data and are not covered by this licence.

The name "Undercut" and its logo are not covered by the licence. Forks are welcome to keep the name while they stay close to this
project; if you change the game substantially or host it publicly, please call it something else so players do not mistake it for this one.