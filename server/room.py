"""One race room: the authoritative race, the clock, who controls which cars, and what each team may see.

Framework free: `server/app.py` only moves messages in and out. The room owns the pace of the clock (the engine never reads
wall time): `advance(wall_seconds)` turns real time into ticks according to the speed. Human actions are stamped with the
tick they are accepted on, never a client time. AI teams run through the same `tick` as everyone, from visible state only.
"""
import json
import secrets
import threading
import time
from pathlib import Path

from engine.actions import SeatNote
from engine.eventlog import EventLog
from engine.race import ENGINE_VERSION, header
from engine.runner import adopt_cars
from engine.rivals import defaults as D
from engine.rivals.policy import RulePolicy
from engine.setup import build_race, start_race
from engine.tick import apply_now, tick
from server.protocol import ProtocolError, parse_action, parse_control, parse_radio
from server.radio import Radio
from server.visibility import filter_event, project


def tyre_guide(bundle, circuit_name):
    """What every team knows about the dry compounds before the race: the averages, not any car's own draw. The pace of a compound
    against the medium, its wear per lap, the spread of where the cliff starts, and how many stops cars made in simulated races here."""
    out = {}
    for name in ("SOFT", "MEDIUM", "HARD"):
        c = bundle["compounds"][name]
        out[name] = {"pace_s": round(c["pace_offset_s"], 3), "wear_s_per_lap": round(c["wear_s_per_lap"], 4),
                     "cliff_s_per_lap": c["cliff"]["extra_s_per_lap"], "cliff_age": list(c["cliff"]["onset_age"]),
                     "cliff_cdf": [round(x, 4) for x in c["cliff"]["onset_cdf"]]}
    block = bundle["circuits"][circuit_name]
    stops = block.get("simulated_stops") or block["stops_distribution"]
    return {"compounds": out, "stops": {k: v for k, v in stops.items()}}


AWAY_S = 30.0          # a multiplayer seat nobody is connected to for this long (wall seconds, while racing) is driven by the AI


class Room:
    """One race. Solo: one human team from the start. Multiplayer (`multiplayer=True`): a lobby on the grid where each
    player claims a free team with `claim`, the host starts the race, and nobody can pause or change the speed after that."""

    def __init__(self, room_id, bundle, setup, human_team=None, cars_controlled=2, speed=1, pause_allowed=True,
                 log_dir=None, multiplayer=False, host_name=None):
        self.id, self.bundle, self.setup = room_id, bundle, dict(setup)
        self.created = time.time()            # wall clock, for the monitor only
        self.race = build_race(bundle, self.setup)
        self.multiplayer, self.cars_controlled, self.host = multiplayer, cars_controlled, human_team
        self.humans = {}                      # team id -> {cars, token, name, connected, away_s, auto}
        self.speed, self.paused, self.pause_allowed = speed, True, pause_allowed and not multiplayer
        self.policies = {t["id"]: RulePolicy(t["id"], self.race.seed, bundle, self.race.circuit_name, self.race.total_laps)
                         for t in bundle["teams"]}
        if human_team:
            self.claim(human_team, host_name)
        self.start_tyres = {}
        self.vote = None                      # a multiplayer speed increase waiting for everyone: {by, to, answers: team -> bool}
        self.vote_note = {"id": 0, "text": ""}     # the last thing worth telling the players about the speed, shown once per id
        self.pending = []
        self.live = None                      # a scoring.live.LiveDebrief, set by the app: the debrief is computed while the race runs
        self.lock = threading.Lock()
        self.log = EventLog(header(bundle, self.setup, self.race, None if multiplayer else human_team, self.human_cars))
        self.log_dir = Path(log_dir) if log_dir else None
        self.outbox = []                      # public events since the last drain, as full engine events
        self._every = max(1, round(D.DECIDE_EVERY_S / self.race.dt))
        self._wall = 0.0
        self.radio = Radio(self)
        self.laps = {c: [] for c in self.race.cars}         # public lap times: car -> [[lap, time, compound, age, flags], ...]
        self._stops_seen = {c: 0 for c in self.race.cars}

    # -- who plays what --------------------------------------------------------------------------------------
    @property
    def human_cars(self):
        return {c for h in self.humans.values() for c in h["cars"]}

    @property
    def human_team(self):
        """The one human team of a solo race (None in a multiplayer race: use `humans`)."""
        return None if self.multiplayer or not self.humans else next(iter(self.humans))

    def claim(self, team, name=None):
        """Seat a player on a free team before the lights go out. Returns the seat's secret token."""
        if team not in self.policies:
            raise ProtocolError(f"unknown team {team!r}")
        if team in self.humans:
            raise ProtocolError(f"{team} is already taken")
        if self.race.session != "GRID":
            raise ProtocolError("the race has started")
        cars = [c.id for c in self.race.cars.values() if c.team == team][:self.cars_controlled]
        self.humans[team] = {"cars": set(cars), "token": secrets.token_urlsafe(9), "name": (name or "").strip()[:20] or team,
                             "connected": False, "away_s": 0.0, "auto": False}
        self.policies[team].exclude |= set(cars)
        return self.humans[team]["token"]

    def seat_ok(self, team, token):
        h = self.humans.get(team)
        return h is not None and secrets.compare_digest(h["token"], token or "")

    def set_connected(self, team, connected):
        """A player's socket count went to or from zero. Coming back takes the cars from the autopilot."""
        h = self.humans.get(team)
        if h is None:
            return
        with self.lock:
            was = h["connected"]
            h["connected"] = connected
            underway = self.multiplayer and self.race.session in ("RACING", "SC", "VSC", "RED")
            if underway and was and not connected:
                self._say(f"{h['name']} disconnected")
            self._refresh_vote()
            if connected:
                h["away_s"] = 0.0
                if h["auto"]:
                    h["auto"] = False
                    self.policies[team].exclude |= h["cars"]
                    self.pending.append(SeatNote(team, "back"))        # logged, so a replay gives the cars back at the same tick
                    self._say(f"{h['name']} is back and has {self._team_name(team)} again")

    def _watch_seats(self, wall_seconds):
        if not self.multiplayer or self.race.session != "RACING":
            return
        for team, h in self.humans.items():
            if h["connected"] or h["auto"]:
                continue
            h["away_s"] += wall_seconds
            if h["away_s"] >= AWAY_S:
                with self.lock:
                    adopt_cars(self.race, self.policies, sorted(h["cars"]))       # the same planning the replay does
                    h["auto"] = True
                    self.pending.append(SeatNote(team, "auto"))         # logged, so a replay hands the cars over at the same tick
                self._say(f"{h['name']} disconnected; the AI is running {self._team_name(team)}")
                self._refresh_vote()

    def players(self):
        return [{"team": t, "name": h["name"], "connected": h["connected"], "auto": h["auto"], "host": t == self.host}
                for t, h in self.humans.items()]

    # -- what a team may see ---------------------------------------------------------------------------------
    def team_cars(self, team_id):
        if team_id in self.humans:
            return set(self.humans[team_id]["cars"])
        return {c.id for c in self.race.cars.values() if c.team == team_id}

    def view(self, team_id):
        return project(self.race, team_id)

    def events_for(self, team_id, events):
        cars = self.team_cars(team_id)
        out = [e for e in (filter_event(e, cars) for e in events) if e]
        for e in out:
            if e["type"] == "lap":                    # the same flags as the lap table, so live laps and the snapshot agree
                row = next((r for r in reversed(self.laps.get(e["payload"]["car"], [])) if r[0] == e["payload"]["lap"]), None)
                e["payload"] = {**e["payload"], "flags": row[4] if row else ""}
        return out

    # -- input -----------------------------------------------------------------------------------------------
    def handle(self, team_id, msg):
        """Apply one client message from `team_id`; raises ProtocolError for anything the team may not do."""
        kind = msg.get("type")
        if team_id not in self.humans:
            raise ProtocolError("this team is run by the AI")
        with self.lock:
            if kind == "action":
                act = parse_action(msg, self.team_cars(team_id))
                if self.race.session == "GRID":
                    if act.__class__.__name__ != "SetStartTyres":
                        raise ProtocolError("only start tyres can be chosen before the race")
                    if self.race.cars[act.car].sets.get(act.compound, 0) <= 0:
                        raise ProtocolError(f"no {act.compound} set left")
                    self.start_tyres[act.car] = act.compound
                elif act.__class__.__name__ == "SetStartTyres":
                    raise ProtocolError("the race has started")
                elif act in self.pending:
                    return []                           # the same click twice before the next tick: one call
                elif self.paused and self.race.session != "FINISHED":
                    return self._act_while_paused(act)  # no tick will come, so apply it now and show the answer
                else:
                    self.pending.append(act)            # stamped with the tick it is applied on
            elif kind == "control":
                op, value = parse_control(msg)
                self._control(team_id, op, value)
            elif kind == "radio":
                return self._radio_message(team_id, msg)
            else:
                raise ProtocolError(f"unknown message type {kind!r}")

    def _act_while_paused(self, act):
        if self.live:
            self.live.take(self)
        ev = apply_now(self.race, [act])
        if self.live:
            self.live.after_tick(self, ev)
        return [e for e in ev if e["type"] != "radio"] + self.radio.observe(ev)

    def _radio_message(self, team_id, msg):
        """Ask a driver something, or answer one of his requests. Returns the radio events to show at once."""
        what, a, b = parse_radio(msg, self.team_cars(team_id))
        if what == "ask":
            return self.radio.ask(a, b)
        action, lines = self.radio.reply(a, b)
        if action is not None:
            if self.race.session in ("GRID", "FINISHED"):
                raise ProtocolError("the race is not on")
            self.pending.append(action)
        return lines

    def _record_laps(self, events):
        """Keep every car's lap times (public timing). Flags: P the car stopped on this lap, S/V/R under a safety car, VSC, red flag."""
        for e in events:
            if e["type"] != "lap":
                continue
            p, car = e["payload"], self.race.cars[e["payload"]["car"]]
            flags = ""
            stops = car.stops + (car.status == "IN_PIT")        # a stop still in progress at the line counts once, here and not again next lap
            if stops > self._stops_seen[car.id]:
                flags += "P"
            self._stops_seen[car.id] = stops
            flags += {"SC": "S", "VSC": "V", "RED": "R"}.get(self.race.session, "")
            self.laps[car.id].append([p["lap"], round(p["lap_time"], 3), p["compound"], p["age"], flags])

    def lap_table(self):
        return self.laps

    def history(self, team_id):
        """What a client that connects now should see of the past: public events plus the team's own radio."""
        past = self.events_for(team_id, self.race.events[-400:])
        past = [e for e in past if e["type"] != "radio"]
        return sorted(past + self.events_for(team_id, self.radio.history[-200:]), key=lambda e: e["tick"])

    # -- the speed in a multiplayer race ---------------------------------------------------------------------
    def _say(self, text):
        self.vote_note = {"id": self.vote_note["id"] + 1, "text": text}

    def _name(self, team):
        return self.humans[team]["name"]

    def _team_name(self, team):
        return next((t["name"] for t in self.race.bundle["teams"] if t["id"] == team), team)

    def vote_view(self):
        v = self.vote
        if v is None:
            return None
        waiting = [t for t, ok in v["answers"].items() if not ok]
        return {"by": v["by"], "by_name": self._name(v["by"]), "to": v["to"], "waiting": waiting, "waiting_names": [self._name(t) for t in waiting]}

    def _speed_request(self, team, value):
        """Slowing down takes effect at once for everyone, so nobody is kept from a quick call. Speeding up needs every connected player."""
        if self.race.session == "FINISHED":
            raise ProtocolError("the race is over")
        if value == self.speed:
            if self.vote and self.vote["by"] == team:
                self.vote = None
                self._say(f"{self._name(team)} withdrew the speed increase")
        elif value < self.speed:
            self.speed, self.vote = value, None
            self._say(f"{self._name(team)} slowed the race to {value}x")
        else:
            self.vote = {"by": team, "to": value, "answers": {team: True}}
            self._say(f"{self._name(team)} wants to increase speed to {value}x")
            self._refresh_vote()

    def _answer_vote(self, team, yes):
        v = self.vote
        if v is None:
            raise ProtocolError("there is no speed vote to answer")
        if team == v["by"] or team not in v["answers"]:
            raise ProtocolError("you are not asked in this vote")
        if not yes:
            self.vote = None
            self._say(f"{self._name(team)} declined the speed increase to {v['to']}x")
        else:
            v["answers"][team] = True
            self._refresh_vote()

    def _refresh_vote(self):
        """Who is asked is whoever is connected and not on the autopilot right now; it settles when all of them have said yes."""
        v = self.vote
        if v is None:
            return
        asked = {t for t, h in self.humans.items() if h["connected"] and not h["auto"]}
        if v["by"] not in asked:
            self.vote = None
            self._say(f"{self._name(v['by'])} is away: the speed increase is off")
            return
        v["answers"] = {t: t == v["by"] or v["answers"].get(t, False) for t in sorted(asked)}
        if all(v["answers"].values()):
            self.speed, self.vote = v["to"], None
            self._say(f"Speed increased to {v['to']}x")

    def _control(self, team_id, op, value):
        if self.multiplayer and op == "vote":
            return self._answer_vote(team_id, value)
        if self.multiplayer and op == "speed" and self.race.session != "GRID":
            return self._speed_request(team_id, value)
        if op == "vote":
            raise ProtocolError("there is no vote in a solo race")
        if self.multiplayer and team_id != self.host:
            raise ProtocolError("only the host can start the race or change the speed")
        if self.multiplayer and op in ("speed", "pause", "resume") and self.race.session != "GRID":
            raise ProtocolError("the speed and the clock are fixed once a multiplayer race has started")
        if op == "start":
            self._lights_out()
        elif op == "speed":
            self.speed = value
        elif op in ("pause", "resume"):
            if op == "pause" and not self.pause_allowed:
                raise ProtocolError("pausing is not allowed in this race")
            self.paused = op == "pause"

    def _lights_out(self):
        if self.race.session != "GRID":
            return
        for tid, pol in self.policies.items():
            for a in pol.start_tyres(project(self.race, tid), {}):
                self.start_tyres.setdefault(a.car, a.compound)
        for cid in self.human_cars:                      # the policy skips human cars; default them to the fitted favourite
            self.start_tyres.setdefault(cid, "MEDIUM")
        if self.multiplayer:
            self.log.header.update(human_teams=sorted(self.humans), human_cars=sorted(self.human_cars))
        start_race(self.race, self.start_tyres)
        self.outbox.extend(self.race.events)
        self.paused = False
        if self.live:
            self.live.begin(self)

    # -- clock -----------------------------------------------------------------------------------------------
    def advance(self, wall_seconds):
        """Run the ticks that `wall_seconds` of real time are worth at the current speed. Returns the events produced."""
        if self.paused or self.race.session in ("GRID", "FINISHED"):
            return []
        self._watch_seats(wall_seconds)
        with self.lock:
            self._wall += wall_seconds * self.speed / self.race.dt
            n, self._wall = int(self._wall), self._wall - int(self._wall)
            out = []
            for _ in range(n):
                out += self._one_tick()
                if self.race.session == "FINISHED":
                    break
            self.outbox.extend(out)
            return out

    def _one_tick(self):
        race, acts = self.race, self.pending
        self.pending = []
        if self.live and any(not isinstance(a, SeatNote) for a in acts):
            self.live.take(self)              # the race as it stands before these calls are applied: what their alternatives start from
        if race.tick % self._every == 0:
            for tid, pol in self.policies.items():
                acts += pol.decide(project(race, tid), {})
        ev = tick(race, acts)
        if self.live:
            self.live.after_tick(self, ev)
        self._record_laps(ev)
        ev = [e for e in ev if e["type"] != "radio"] + self.radio.observe(ev)       # the radio turns engine chatter into lines
        if race.session == "FINISHED":
            self.log.extend(race.events)
            self._save_log()
        return ev

    def _save_log(self):
        if self.log_dir:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            self.log.write(self.log_dir / f"{self.id}.jsonl")
            with open(self.log_dir / f"{self.id}.radio.jsonl", "w") as f:
                f.write("\n".join(json.dumps(e, sort_keys=True) for e in self.radio.history) + "\n")

    def info(self, team=None):
        """Race info. For a seated team (`team`) `human_team` and `human_cars` are that team's own, which is what the screens treat as
        "mine"; without one (a spectator, the lobby listing) a multiplayer race names no team and lists every human car."""
        mine = team if team in self.humans else None
        return {"id": self.id, "engine_version": ENGINE_VERSION, "circuit": self.race.circuit_name,
                "total_laps": self.race.total_laps, "full_laps": self.race.circuit["total_laps"], "corners": self.race.circuit["corners"], "human_team": mine or self.human_team,
                "human_cars": sorted(self.humans[mine]["cars"] if mine else self.human_cars),
                "multiplayer": self.multiplayer, "host": self.host, "players": self.players(),
                "pit_loss_s": round(self.race.circuit["pit_loss_green_s"], 2),
                "pit_loss_sc_s": round(self.race.bundle["safety"]["sc_pit_ratio"] * self.race.circuit["pit_loss_green_s"], 2),
                "pit_loss_vsc_s": round(self.race.bundle["safety"]["vsc_pit_ratio"] * self.race.circuit["pit_loss_green_s"], 2), "swap_window_s": self.race.bundle["team_orders"]["window_s"],
                "pit_call_deadline_frac": round(self.race.circuit["pit_entry_frac"] - self.race.circuit["pit_call_cutoff_frac"], 4), "traffic_window_s": self.race.bundle["traffic"]["window_s"],
                "fuel_s_per_lap": round(self.race.bundle["fuel_s_per_lap"], 5),
                "sc_rate_per_lap": round(self.race.circuit["sc_rate_per_lap"], 4), "lap_length_m": self.race.circuit["lap_length_m"], "tyre_guide": tyre_guide(self.race.bundle, self.race.circuit_name)}
