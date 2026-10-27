"""Team radio: what the drivers say, what the race engineer relays, and what the strategist can ask.

Informational only. Nothing here changes the race: a request becomes an ordinary action only when the strategist accepts it
(and then it goes through the same validation as any other call), so replays and the debrief are unaffected. Answers are built
from the hidden truth (true tyre wear and where the cliff is, the track wetness, rain about to arrive, damage, how much faster
the car is than the one ahead) seen through a driver's noise, so asking is a way to learn what the timing screen does not
show. All wording and noise are drawn from the seed and the order of calls.

Message payload (own team only, event type `radio`): id, car, from ("driver" | "engineer"), speaker, message, topic,
reply_to, and for a driver's request: request = {kind, label, expires}. Client to server: {"type":"radio","op":"ask","car",
"topic"} with topic in TOPICS, and {"type":"radio","op":"reply","id","answer":"yes"|"no"}.
"""
import heapq

import numpy as np

from engine import weather
from engine.actions import CallBox, SwapPositions
from engine.rng import stream
from engine.state import COMPOUNDS, WET_COMPOUNDS, tyre_loss_s
from server.protocol import ProtocolError

TOPICS = ("tyres", "weather", "track", "car", "pace")
ASK_COOLDOWN_S = 20.0
SAFETY_ASK_MIN_AGE = 10        # laps on the tyres before the driver asks about stopping under a safety car or VSC
PROACTIVE_COOLDOWN_S = 45.0
REQUEST_LIFETIME_S = 45.0
STYLES = ("calm", "blunt", "chatty")
ASK_TEXT = {"tyres": "How are the tyres?", "weather": "What's the weather doing out there?",
            "track": "How's the grip, and how's the traffic?", "car": "Any problems with the car?",
            "pace": "What's your pace like compared with the cars around you?"}


FAILURES = ["engine", "gearbox", "hydraulic", "electrical", "brake", "cooling", "suspension"]


class Radio:
    def __init__(self, room):
        self.room, self.seed = room, room.race.seed
        self._ids, self.history, self.requests = 0, [], {}
        self._queue, self._seq = [], 0                       # replies waiting for their moment: (due time, seq, message)
        self._cool = {}
        self._rain = None                                    # was it raining at the last look
        self._track = None
        self._rng = {}
        self._warned_rain = set()
        self.style = {c: STYLES[int(stream(self.seed, "radio", c, "style").integers(len(STYLES)))] for c in room.race.cars}

    # -- helpers ---------------------------------------------------------------------------------------------
    def rng(self, car):
        if car not in self._rng:
            self._rng[car] = stream(self.seed, "radio", car, "talk")
        return self._rng[car]

    def surname(self, car):
        return self.room.race.cars[car].driver.split()[-1]

    def pick(self, car, options):
        return options[int(self.rng(car).integers(len(options)))]

    def _make(self, car, who, text, topic, reply_to=None, request=None):
        self._ids += 1
        speaker = self.surname(car) if who == "driver" else "Race engineer"
        payload = {"id": self._ids, "car": car, "from": who, "speaker": speaker, "message": text, "topic": topic,
                   "reply_to": reply_to, "request": request}
        return {"tick": self.room.race.tick, "type": "radio", "payload": payload}

    def _later(self, delay, ev):
        self._seq += 1
        heapq.heappush(self._queue, (self.room.race.time() + delay, self._seq, ev))

    def _cooled(self, car, topic, now, span=PROACTIVE_COOLDOWN_S) -> bool:
        if now - self._cool.get((car, topic), -1e9) < span:
            return False
        self._cool[(car, topic)] = now
        return True

    def _noise(self, car, sd):
        return float(self.rng(car).normal(0.0, sd))

    # -- the strategist asks ---------------------------------------------------------------------------------
    def ask(self, car, topic):
        race = self.room.race
        if topic not in TOPICS:
            raise ProtocolError(f"ask about one of {', '.join(TOPICS)}")
        c = race.cars[car]
        if race.session in ("GRID", "FINISHED") or c.status not in ("RUNNING", "IN_PIT"):
            raise ProtocolError(f"{self.surname(car)} is not on track")
        now = race.time()
        if now - self._cool.get((car, "ask-" + topic), -1e9) < ASK_COOLDOWN_S:
            raise ProtocolError(f"you have just asked {self.surname(car)} that")
        self._cool[(car, "ask-" + topic)] = now
        q = self._make(car, "engineer", f"{self.surname(car)}, {ASK_TEXT[topic][0].lower()}{ASK_TEXT[topic][1:]}", topic)
        self.history.append(q)
        a = self._make(car, "driver", self._answer(car, topic), topic, reply_to=q["payload"]["id"])
        self._later(2.0 + 3.0 * float(self.rng(car).random()), a)
        return [q]

    def _answer(self, car, topic) -> str:
        return getattr(self, f"_say_{topic}")(car)

    def _say_tyres(self, car):
        race = self.room.race
        c = race.cars[car]
        loss = max(tyre_loss_s(c, race) + self._noise(car, 0.15), 0.0)
        if loss < 0.4:
            text = self.pick(car, ["Tyres feel good.", "Plenty left in them.", "No complaints, they're fine."])
        elif loss < 0.9:
            text = self.pick(car, ["A bit of wear, nothing to worry about yet.", "They're coming down a little.", "Still decent."])
        elif loss < 1.5:
            text = self.pick(car, ["They're starting to drop off, I'm losing some pace.", "Graining a bit now.", "Going away slowly."])
        elif loss < 2.2:
            text = f"The tyres are going. I'm losing about {loss:.1f} seconds a lap."
        else:
            text = f"Tyres are finished! I'm losing {loss:.1f} a lap, we need to stop."
        remaining = c.cliff_onset - c.age + self._noise(car, 2.0)
        if c.compound in COMPOUNDS and 0 < remaining <= 8:
            text += f" I reckon about {max(round(remaining), 1)} laps before they really fall away."
        elif c.compound in COMPOUNDS and remaining <= 0:
            text += " They've fallen off the cliff."
        w = race.weather["w"] if race.weather else 0.0
        if c.compound == "INTERMEDIATE" and w < 0.12:
            text += " These inters are too much for this track."
        if c.compound in COMPOUNDS and w >= 0.4:
            text += " And these slicks are no good on this wet track."
        return text

    def _say_weather(self, car):
        race = self.room.race
        c = race.cars[car]
        wx = race.weather
        if wx is None:
            return "Dry as a bone."
        w = min(max(wx["w"] + self._noise(car, 0.07), 0.0), 1.0)
        t = race.time()
        raining = weather.raining(wx, t)
        parts = []
        if raining:
            parts.append("It's raining, quite hard." if raining == 2 else "It's raining, lightly.")
        else:
            soon = [(t0 - t) for t0, _, _ in wx["intervals"] if 0 < t0 - t <= 2.0 * race.circuit["base_lap_s"]]
            if soon and self.rng(car).random() < 0.8:
                corner = self.pick(car, [x["n"] for x in race.circuit["corners"]])
                parts.append(f"I can see rain coming, spots on the visor at Turn {corner}.")
        parts.append("The track is " + ("dry." if w < 0.1 else "damp, there's a dry line." if w < 0.45 else "properly wet."))
        deltas = race.bundle["weather"]["lap_delta"]
        best = min(("MEDIUM", "INTERMEDIATE", "WET"), key=lambda k: float(np.interp(w, weather.W_GRID, deltas[k])))
        on_wet = c.compound in WET_COMPOUNDS
        if best == "MEDIUM" and on_wet:
            parts.append("I'd say slicks would be quicker now.")
        elif best != "MEDIUM" and not on_wet:
            parts.append(f"I think we need {'full wets' if best == 'WET' else 'intermediates'}.")
        elif best == "WET" and c.compound == "INTERMEDIATE":
            parts.append("Inters are struggling, full wets would help.")
        elif best == "INTERMEDIATE" and c.compound == "WET":
            parts.append("The wets are too much now, inters would be better.")
        return " ".join(parts)

    def _ahead(self, car):
        race = self.room.race
        order = [i for i in race.order() if race.cars[i].status == "RUNNING"]
        k = order.index(car) if car in order else -1
        return (race.cars[order[k - 1]] if k > 0 else None), (race.cars[order[k + 1]] if 0 <= k < len(order) - 1 else None)

    def _say_track(self, car):
        race = self.room.race
        wx = race.weather
        w = 0.0 if wx is None else min(max(wx["w"] + self._noise(car, 0.07), 0.0), 1.0)
        grip = "Grip is good." if w < 0.1 else "Grip is a bit low in places." if w < 0.45 else "Grip is very low, it's slippery."
        ahead, _ = self._ahead(car)
        c = race.cars[car]
        if ahead is not None:
            gap = (ahead.progress - c.progress) * c.lt
            tr = race.bundle["traffic"]
            if gap < tr["window_s"]:
                loss = tr["loss_s"] * (1 - gap / tr["window_s"]) + self._noise(car, 0.05)
                return f"{grip} I'm in dirty air behind {self.surname(ahead.id)}, losing about {max(loss, 0.05):.1f} a lap."
        return f"{grip} Clear air, no traffic problems."

    def _say_car(self, car):
        c = self.room.race.cars[car]
        if c.damage_s > 0:
            loss = max(c.damage_s + self._noise(car, 0.1), 0.05)
            return f"I've got damage from the contact. The car is about {loss:.1f} a lap slower."
        return self.pick(car, ["The car feels fine.", "No problems, balance is good.", "Everything is OK."])

    def _say_pace(self, car):
        race = self.room.race
        c = race.cars[car]
        ahead, behind = self._ahead(car)
        bits = []
        if ahead is not None:
            d = ahead.pace_now - c.pace_now + self._noise(car, 0.15)                 # positive: we are quicker
            bits.append(f"I'm about {abs(d):.1f} s a lap {'quicker' if d > 0 else 'slower'} than {self.surname(ahead.id)} in front.")
        if behind is not None:
            d = behind.pace_now - c.pace_now + self._noise(car, 0.15)
            bits.append(f"{self.surname(behind.id)} behind looks {abs(d):.1f} s a lap {'slower' if d > 0 else 'quicker'} than me.")
        return " ".join(bits) or "I'm in clear air, running my own race."

    # -- the strategist answers a request --------------------------------------------------------------------
    def reply(self, rid, answer):
        """Accept or decline a driver's request. Returns the action to apply (or None) and any radio lines to show now."""
        req = self.requests.get(rid)
        if req is None or self.room.race.time() > req["expires"]:
            self.requests.pop(rid, None)
            raise ProtocolError("that request has expired")
        if answer not in ("yes", "no"):
            raise ProtocolError("answer yes or no")
        self.requests.pop(rid)
        car = req["car"]
        if answer == "no":
            line = self._make(car, "engineer", self.pick(car, ["Negative, stay out.", "Not now, keep going.", "No, carry on as you are."]),
                              req["topic"], reply_to=rid)
            self._later(1.5, self._make(car, "driver", self.pick(car, ["OK.", "Understood.", "Copy."]), req["topic"]))
            self.history.append(line)
            return None, [line, self._closed(rid, "declined", car)]
        line = self._make(car, "engineer", req["confirm"], req["topic"], reply_to=rid)
        self.history.append(line)
        self._later(1.5, self._make(car, "driver", self.pick(car, ["Copy.", "OK, understood.", "Box, box, got it."]), req["topic"]))
        return req["action"], [line, self._closed(rid, "accepted", car)]

    def _closed(self, rid, reason, car):
        return {"tick": self.room.race.tick, "type": "radio_request_closed", "payload": {"id": rid, "reason": reason, "car": car}}

    def _request(self, car, kind, label, action, confirm, topic):
        """A driver's message that asks the strategist something. Accepting runs `action`; the message text is set by the caller."""
        now = self.room.race.time()
        ev = self._make(car, "driver", "", topic)
        rid = ev["payload"]["id"]
        self.requests[rid] = {"car": car, "action": action, "confirm": confirm, "topic": topic, "expires": now + REQUEST_LIFETIME_S}
        ev["payload"]["request"] = {"kind": kind, "label": label, "expires": now + REQUEST_LIFETIME_S}
        return ev

    # -- what the drivers say on their own, and the engineer's side of the strategist's calls -----------------
    def observe(self, events):
        """Radio lines for this tick: from the engine's events, from what the drivers notice, and replies now due."""
        race, out = self.room.race, []
        now = race.time()
        for e in events:
            out += self._on_event(e, now)
        if race.tick % self.room._every == 0:
            out += self._notice(now)
        while self._queue and self._queue[0][0] <= now:
            out.append(heapq.heappop(self._queue)[2])
        for rid in [r for r, q in self.requests.items() if now > q["expires"]]:
            car = self.requests.pop(rid)["car"]
            out.append({"tick": race.tick, "type": "radio_request_closed", "payload": {"id": rid, "reason": "expired", "car": car}})
        out = [e for e in out if e["payload"].get("car") in self.room.human_cars or e["type"] == "radio_request_closed"]
        self.history.extend(e for e in out if e["type"] == "radio")
        return out

    def _on_event(self, e, now):
        p, t, out = e["payload"], e["type"], []
        car = p.get("car")
        if car not in self.room.human_cars:
            return out
        if t == "box_ack" and p["ok"]:
            out.append(self._make(car, "engineer", self._engineer_box(car, p["message"]), "pit"))
            self._later(2.0, self._make(car, "driver", self.pick(car, ["Copy.", "OK, box this lap.", "Understood."]), "pit"))
        elif t == "swap_ack" and p["ok"]:
            out.append(self._make(car, "engineer", f"{self.surname(car)}, {p['message'].split(': ', 1)[-1]}.", "swap"))
            self._later(2.0, self._make(car, "driver", self.pick(car, ["Understood.", "Copy, I'll let him through.", "OK."]), "swap"))
        elif t == "swap_done":
            self._later(1.0, self._make(car, "driver", self.pick(car, ["He's through.", "Done.", "OK, he's by."]), "swap"))
        elif t == "swap_failed":
            self._later(0.5, self._make(car, "driver", "I couldn't get him close enough in time.", "swap"))
        elif t == "radio":                                   # the driver queries a swap order (engine/orders.py)
            out.append(self._make(car, "driver", p["message"].split(": ", 1)[-1], "swap"))
        elif t == "damage":
            out.append(self._make(car, "driver", self.pick(car, ["Contact! I think I've got some damage.", "I got hit, something's not right."]), "car"))
            self._later(2.0, self._make(car, "engineer", "Copy, we'll check the data.", "car"))
        elif t == "retirement":
            mechanical = p["cause"] == "mechanical"
            out.append(self._make(car, "driver", "I have to stop, the car's gone." if mechanical else "That's it, I'm out of the race.", "car"))
            if mechanical:                                   # the engine records no part: the engineer names one (radio only, no effect on the race)
                part = self.pick(car, FAILURES)
                end = "Stay in the garage." if p.get("where") == "pit" else "Park it somewhere safe."
                text = f"{self.surname(car)}, retire the car, {part} failure. {end}"
            else:
                text = f"{self.surname(car)}, retire the car, the damage is too severe. Park it somewhere safe."
            self._later(2.5, self._make(car, "engineer", text, "car"))
        return out

    def _engineer_box(self, car, message):
        s = self.surname(car)
        if message == "Box opposite cancelled":
            return f"{s}, box opposite cancelled."
        if message == "Box cancelled":
            return f"{s}, box cancelled, stay out."
        if message.startswith("Box opposite "):                      # "Box opposite Brackett, hard if we box"
            target, _, rest = message[len("Box opposite "):].partition(", ")
            return (f"{s}, we are watching {target}. At our pit entry, if {target} has stayed out we box for "
                    f"{rest.removesuffix(' if we box')}; if {target} has boxed we stay out.")
        if message.endswith(" has boxed: stay out"):
            return f"{s}, {message.removesuffix(' has boxed: stay out')} has boxed. Stay out."
        if " stayed out: box, " in message:
            target, _, tyre = message.partition(" stayed out: box, ")
            return f"{s}, {target} stayed out. Box, box, {tyre} tyres."
        tyre = message.split(", ")[-1] if ", " in message else "tyres"
        if message.startswith("Tyre change"):
            return f"{self.surname(car)}, free tyre change under the red flag: {tyre}."
        if message.startswith("Too late"):
            return f"{self.surname(car)}, box NEXT lap, {tyre}. Stay out this time."
        return f"{self.surname(car)}, box, box. {tyre.capitalize()} tyres."

    def _notice(self, now):
        race, out = self.room.race, []
        wx = race.weather
        raining = bool(wx and weather.raining(wx, race.time()))
        for car in sorted(self.room.human_cars):
            c = race.cars[car]
            if c.status != "RUNNING":
                continue
            out += self._notice_tyres(car, c, now)
            out += self._notice_weather(car, c, wx, raining, now)
            out += self._notice_traffic(car, c, now)
            if c.box_call and wx and self._cooled(car, "question-call", now, 60.0):
                out += self._question_call(car, c, wx)
            # once per safety period, and only when the tyres are well used: a fresh set is not worth a stop under the flag
            if race.session in ("SC", "VSC") and c.age >= SAFETY_ASK_MIN_AGE and not c.box_call and (car, "sc-box", race.safety_count) not in self._cool:
                self._cool[(car, "sc-box", race.safety_count)] = now
                out += self._ask_box(car, c, f"{race.session} is out! Do we box?", "Box now under the " + race.session, "safety")
            if race.session == "RED" and self._cooled(car, "red-tyres", now, 600.0):
                out += self._ask_box(car, c, "Red flag. What tyres do we want?", "Change tyres under the red flag", "red")
        self._rain, self._track = raining, ("dry" if not wx or wx["w"] < 0.1 else "damp" if wx["w"] < 0.45 else "wet")
        return out

    def _notice_tyres(self, car, c, now):
        race = self.room.race
        loss = tyre_loss_s(c, race) + self._noise(car, 0.1)
        out = []
        for threshold, text, ask in ((1.8, "The tyres are gone, we need to stop.", True), (1.0, "Tyres are starting to go off.", False)):
            key = (car, c.stops, threshold)
            if loss >= threshold and key not in self._cool and race.session in ("RACING", "SC", "VSC"):
                self._cool[key] = now
                out.append(self._make(car, "driver", text, "tyres"))
                if ask and not c.box_call:
                    out += self._ask_box(car, c, "Are we boxing this lap?", "Box now", "tyres")
                break
        return out

    def _next_compound(self, c):
        wx = self.room.race.weather
        wet = bool(wx and (wx["w"] >= 0.1 or weather.raining(wx, self.room.race.time())))
        pool = [k for k in (("INTERMEDIATE", "WET") if wet else ("HARD", "MEDIUM", "SOFT")) if c.sets.get(k, 0) > 0]
        left = self.room.race.total_laps - c.lap
        if not wet:
            pool.sort(key=lambda k: {"HARD": 0 if left >= 25 else 2, "MEDIUM": 1, "SOFT": 0 if left < 12 else 2}[k])
        return pool[0] if pool else None

    def _ask_box(self, car, c, question, label, topic):
        compound = self._next_compound(c)
        if compound is None:
            return []
        action = CallBox(car, compound)
        name = compound.lower()
        ev = self._request(car, "box", f"{label}: {name}", action, f"{self.surname(car)}, box, box. {name.capitalize()} tyres.", topic)
        ev["payload"]["message"] = question
        return [ev]

    def _notice_weather(self, car, c, wx, raining, now):
        race, out = self.room.race, []
        if wx is None:
            return out
        if self._rain is not None and raining and not self._rain and self._cooled(car, "rain-start", now, 30.0):
            out.append(self._make(car, "driver", self.pick(car, ["It's started to rain!", "Rain! It's coming down now."]), "weather"))
            if c.compound in COMPOUNDS and not c.box_call:
                out += self._ask_box(car, c, "Do we box for inters?", "Box for the rain", "weather")
        elif self._rain and not raining and self._cooled(car, "rain-stop", now, 30.0):
            out.append(self._make(car, "driver", "The rain has stopped, the track is still wet.", "weather"))
        else:
            soon = [t0 - race.time() for t0, _, _ in wx["intervals"] if 0 < t0 - race.time() <= 1.5 * race.circuit["base_lap_s"]]
            key = (car, "rain-warning", round(wx["intervals"][0][0])) if wx["intervals"] else None
            if soon and key and key not in self._warned_rain and self.rng(car).random() < 0.6:
                self._warned_rain.add(key)
                out.append(self._make(car, "driver", "I can feel a few spots of rain, it might be coming.", "weather"))
        label = "dry" if wx["w"] < 0.1 else "damp" if wx["w"] < 0.45 else "wet"
        if self._track == "damp" and label == "dry" and c.compound in WET_COMPOUNDS and self._cooled(car, "dry-line", now, 60.0):
            out.append(self._make(car, "driver", "The track is nearly dry now, these tyres are getting hot.", "weather"))
            out += self._ask_box(car, c, "Can we come in for slicks?", "Box for slicks", "weather")
        return out

    def _notice_traffic(self, car, c, now):
        race = self.room.race
        if race.session != "RACING" or race.total_laps - c.lap <= 4 or c.lap < 3:
            return []
        ahead, _ = self._ahead(car)
        if ahead is None or ahead.id not in self.room.human_cars or ahead.status != "RUNNING":
            return []
        gap = (ahead.progress - c.progress) * c.lt
        if gap <= 1.2 and ahead.pace_now - c.pace_now >= 0.3 and ahead.swap is None and self._cooled(car, "swap-request", now, 90.0):
            action = SwapPositions(ahead.id, car, "asap")
            ev = self._request(car, "swap", "Let him past", action,
                               f"{self.surname(ahead.id)}, {self.surname(car)} is quicker: let him by.", "swap")
            ev["payload"]["message"] = self.pick(car, ["I'm quicker than him, can I get past?", "I'm being held up, let me by?"])
            return [ev]
        return []

    def _question_call(self, car, c, wx):
        race = self.room.race
        want = c.box_call["compound"]
        w = wx["w"]
        if want in COMPOUNDS and w >= 0.35:
            return [self._make(car, "driver", "Are you sure about slicks? It's properly wet out here.", "pit")]
        if want in WET_COMPOUNDS and w < 0.08 and not weather.raining(wx, race.time()):
            return [self._make(car, "driver", "It's dry now, inters will be destroyed. Are you sure?", "pit")]
        return []
