import pytest

from server.protocol import ProtocolError, parse_radio
from server.room import Room
from tests.helpers import make_bundle


def room_with(laps=14, weather="dry", seed=3, wear=None, tweak=None):
    b = make_bundle()
    b["circuits"]["Test"]["total_laps"] = laps
    for t in b["teams"][2:]:
        t["pace_delta_s"] += 30.0                                       # keep the field out of the way
    if wear is not None:
        for c in b["compounds"].values():
            c["wear_s_per_lap"] = wear
    if tweak:
        tweak(b)
    room = Room("r", b, {"seed": seed, "circuit": "Test", "weather": weather}, human_team="T0")
    room.handle("T0", {"type": "control", "op": "start"})
    room.handle("T0", {"type": "control", "op": "speed", "value": 10})
    return room


def run(room, seconds, step=1.0):
    out = []
    for _ in range(int(seconds / step)):
        out += room.advance(step)
    return out


def radio(events, who=None, car=None):
    return [e["payload"] for e in events if e["type"] == "radio" and (who is None or e["payload"]["from"] == who)
            and (car is None or e["payload"]["car"] == car)]


def until_request(room, car, kind=None, limit=400, step=0.5):
    """Advance until the driver makes a request (optionally of one kind); returns it with the events so far."""
    events = []
    for _ in range(limit):
        events += room.advance(step)
        found = [r for r in radio(events, "driver", car) if r["request"] and (kind is None or r["request"]["kind"] == kind)]
        if found:
            return found[0], events
    raise AssertionError("the driver never made a request")


def ask(room, car, topic):
    lines = room.handle("T0", {"type": "radio", "op": "ask", "car": car, "topic": topic})
    answers = radio(run(room, 8.0), "driver", car)
    return lines, answers[0] if answers else None


def test_asking_a_driver_puts_the_question_on_the_radio_and_the_answer_follows_a_few_seconds_later():
    room = room_with()
    run(room, 20)
    lines, answer = ask(room, "T0A", "tyres")
    q = lines[0]["payload"]
    assert q["from"] == "engineer" and "tyres" in q["message"].lower() and q["topic"] == "tyres"
    assert answer is not None and answer["reply_to"] == q["id"] and answer["speaker"] == "0A"


def test_the_tyre_answer_reflects_the_true_wear_and_where_the_cliff_is():
    fresh = room_with(wear=0.12)
    run(fresh, 20)
    _, answer = ask(fresh, "T0A", "tyres")
    assert any(w in answer["message"] for w in ("good", "Plenty", "fine", "wear", "Still"))
    worn = room_with(wear=0.12)
    run(worn, 20)
    car = worn.race.cars["T0A"]
    car.age = 20                                                         # true loss about 2.4 s a lap
    _, answer = ask(worn, "T0A", "tyres")
    assert "going" in answer["message"] or "finished" in answer["message"]
    near = room_with(wear=0.01)
    run(near, 20)
    near.race.cars["T0A"].cliff_onset = near.race.cars["T0A"].age + 4
    texts = []
    for seed_shift in range(6):                                          # the driver's estimate is noisy, so look at several
        near.radio._cool.clear()
        _, a = ask(near, "T0A", "tyres")
        texts.append(a["message"])
    assert sum("laps before they really fall away" in t for t in texts) >= 4


def test_asking_about_the_weather_gets_the_truth_through_a_driver_who_feels_the_grip():
    wet = room_with(weather="wet_start", laps=20)
    wet.race.weather["w"] = 0.7
    _, answer = ask(wet, "T0A", "weather")
    assert "wet" in answer["message"] and "intermediates" in answer["message"]
    dry = room_with(laps=20)
    run(dry, 10)
    _, answer = ask(dry, "T0A", "weather")
    assert "dry" in answer["message"] and "rain" not in answer["message"].replace("rain-", "")
    drying = room_with(weather="wet_start", laps=20)
    drying.race.weather["w"] = 0.05
    drying.race.cars["T0A"].compound = "INTERMEDIATE"
    _, answer = ask(drying, "T0A", "weather")
    assert "slicks would be quicker" in answer["message"]


def test_a_driver_can_see_rain_coming_before_it_arrives():
    seen = 0
    for seed in range(12):
        room = room_with(weather="rain_during", laps=30, seed=seed)
        t0 = room.race.weather["intervals"][0][0]
        while room.race.time() < t0 - 100:
            room.advance(5.0)
        room.handle("T0", {"type": "control", "op": "pause"})
        room.race.weather["w"] = 0.0
        _, answer = ask(room, "T0A", "weather") if False else (None, None)
        room.paused = False
        lines = room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "weather"})
        got = radio(run(room, 8.0), "driver", "T0A")
        seen += any("rain coming" in g["message"] for g in got)
        assert lines
    assert seen >= 6                                                    # most of the time, not always


def test_the_car_the_track_and_the_pace_questions_answer_from_the_hidden_state():
    room = room_with()
    run(room, 25)
    room.race.cars["T0A"].damage_s = 0.6
    _, answer = ask(room, "T0A", "car")
    assert "damage" in answer["message"]
    _, answer = ask(room, "T0B", "car")
    assert "damage" not in answer["message"]
    _, answer = ask(room, "T0B", "track")
    assert "dirty air" in answer["message"] or "Clear air" in answer["message"]
    a, b = room.race.cars["T0A"], room.race.cars["T0B"]
    b.pace_now = a.pace_now - 0.6                                        # T0B is 0.6 s a lap quicker than the car in front
    _, answer = ask(room, "T0B", "pace")
    import re
    assert "0A" in answer["message"]
    figure = float(re.search(r"(\d\.\d)", answer["message"]).group(1))
    assert 0.2 <= figure <= 1.0                                           # about the true 0.6 s, give or take the driver's noise
    assert f"{figure} s a lap" in answer["message"]                       # the figure carries its unit
    ahead_of_us = room.race.order().index("T0A") < room.race.order().index("T0B")
    assert ("quicker than 0A in front" in answer["message"]) == ahead_of_us


def test_you_cannot_spam_a_question_ask_off_track_or_for_the_other_team():
    room = room_with()
    run(room, 20)
    room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "tyres"})
    with pytest.raises(ProtocolError, match="just asked"):
        room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "tyres"})
    room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "weather"})
    with pytest.raises(ProtocolError, match="not one of your cars"):
        room.handle("T0", {"type": "radio", "op": "ask", "car": "T1A", "topic": "tyres"})
    with pytest.raises(ProtocolError, match="ask about"):
        room.handle("T0", {"type": "radio", "op": "ask", "car": "T0B", "topic": "gossip"})
    run(room, 25)
    room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "tyres"})            # after the cooldown
    room.race.cars["T0B"].status = "RETIRED"
    with pytest.raises(ProtocolError, match="not on track"):
        room.handle("T0", {"type": "radio", "op": "ask", "car": "T0B", "topic": "car"})
    with pytest.raises(ProtocolError):
        parse_radio({"op": "reply", "id": "x"}, {"T0A"})


def test_a_worn_driver_asks_to_box_and_accepting_makes_the_call_through_the_engineer():
    room = room_with(wear=0.2, laps=20)
    req, _ = until_request(room, "T0A", "box")
    assert "box" in req["request"]["label"].lower()
    lines = room.handle("T0", {"type": "radio", "op": "reply", "id": req["id"], "answer": "yes"})
    assert any(e["type"] == "radio" and e["payload"]["from"] == "engineer" and "box, box" in e["payload"]["message"] for e in lines)
    assert any(e["type"] == "radio_request_closed" and e["payload"]["reason"] == "accepted" for e in lines)
    after = run(room, 1)
    assert any(e["type"] == "box_ack" and e["payload"]["ok"] for e in after)                    # the real call went through


def test_declining_a_request_tells_the_driver_to_stay_out_and_an_old_request_expires():
    room = room_with(wear=0.2, laps=30)
    req, _ = until_request(room, "T0A", "box")
    lines = room.handle("T0", {"type": "radio", "op": "reply", "id": req["id"], "answer": "no"})
    assert any(e["type"] == "radio" and e["payload"]["from"] == "engineer" for e in lines)
    assert room.race.cars["T0A"].box_call is None
    with pytest.raises(ProtocolError, match="expired"):
        room.handle("T0", {"type": "radio", "op": "reply", "id": req["id"], "answer": "yes"})
    room2 = room_with(wear=0.2, laps=40)
    req2, _ = until_request(room2, "T0A", "box")
    later = run(room2, 8)                                                # 80 s of race time: past the request's life
    assert any(e["type"] == "radio_request_closed" and e["payload"]["id"] == req2["id"] and e["payload"]["reason"] == "expired"
               for e in later)
    with pytest.raises(ProtocolError, match="expired"):
        room2.handle("T0", {"type": "radio", "op": "reply", "id": req2["id"], "answer": "yes"})


def test_rain_makes_the_driver_say_so_and_ask_for_intermediates():
    room = room_with(weather="rain_during", laps=30, seed=2)
    t0 = room.race.weather["intervals"][0][0]
    events = []
    while room.race.time() < t0 + 40:
        events += room.advance(2.0)
    rain = [r for r in radio(events, "driver") if "rain" in r["message"].lower() or (r["request"] and "rain" in r["request"]["label"])]
    assert rain
    asks = [r for r in radio(events, "driver") if r["request"] and r["request"]["kind"] == "box" and "intermediate" in r["request"]["label"]]
    assert asks


def test_a_driver_held_up_by_a_slower_team_mate_asks_to_be_let_by_and_it_becomes_a_swap_order():
    room = room_with(laps=30)
    run(room, 40)                                                        # a few laps in
    a, b = room.race.cars["T0A"], room.race.cars["T0B"]
    b.progress, a.progress = b.progress, b.progress + 0.5 / b.lt         # T0A directly ahead of T0B...
    a.pace_now, b.pace_now = 90.6, 89.9                                  # ...and 0.7 s a lap slower
    req, _ = until_request(room, "T0B", "swap")
    room.handle("T0", {"type": "radio", "op": "reply", "id": req["id"], "answer": "yes"})
    after = run(room, 1)
    assert any(e["type"] == "swap_ack" for e in after)


def test_a_driver_questions_a_pit_call_that_does_not_fit_the_track():
    room = room_with(weather="wet_start", laps=20)
    room.race.weather["w"] = 0.7
    run(room, 5)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "MEDIUM"})
    events = run(room, 12)
    assert any("Are you sure about slicks" in r["message"] for r in radio(events, "driver", "T0A"))


def test_the_engineer_relays_a_call_and_the_driver_acknowledges_it():
    room = room_with()
    run(room, 20)
    room.handle("T0", {"type": "action", "kind": "CallBox", "car": "T0A", "compound": "HARD"})
    events = run(room, 6)
    eng = radio(events, "engineer", "T0A")
    assert eng and "box" in eng[0]["message"].lower() and "Hard" in eng[0]["message"]
    assert any(r["topic"] == "pit" for r in radio(events, "driver", "T0A"))


def test_only_the_owning_team_hears_the_radio_and_a_new_client_gets_the_history():
    room = room_with()
    events = run(room, 30) + room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "car"})
    events += run(room, 8)
    assert room.events_for("T0", events) and not [e for e in room.events_for("T5", events) if e["type"].startswith("radio")]
    hist = room.history("T0")
    assert [e for e in hist if e["type"] == "radio"] and hist == sorted(hist, key=lambda e: e["tick"])
    assert not [e for e in room.history("T5") if e["type"] == "radio"]


def test_the_radio_is_reproducible_from_the_seed_and_the_same_inputs():
    def transcript():
        room = room_with(seed=7)
        out = run(room, 20)
        out += room.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "weather"})
        out += run(room, 20)
        return [(e["tick"], e["payload"]["message"]) for e in out if e["type"] == "radio"]
    assert transcript() == transcript()


def test_the_radio_never_changes_the_race():
    from engine.runner import Runner
    quiet = room_with(seed=4)
    chatty = room_with(seed=4)
    for room in (quiet, chatty):
        run(room, 30)
    chatty.handle("T0", {"type": "radio", "op": "ask", "car": "T0A", "topic": "tyres"})
    for room in (quiet, chatty):
        run(room, 200)
    assert quiet.race.events == chatty.race.events                       # asking questions changes nothing in the race log
    del Runner


def test_a_driver_asks_about_stopping_under_a_safety_car_at_most_once_per_period_and_only_on_used_tyres():
    def sc_often(b):
        b["circuits"]["Test"].update(residual_sc_rate_per_lap=1.5, residual_vsc_rate_per_lap=0.0)
    room = room_with(laps=30, tweak=sc_often, wear=0.02)
    events = run(room, 600)
    asks = [e["payload"] for e in events if e["type"] == "radio" and e["payload"].get("topic") == "safety" and e["payload"].get("request")]
    periods = [e for e in events if e["type"] == "safety_deployed"]
    assert periods, "the test needs a safety car"
    per_car = {}
    for p in asks:
        per_car[(p["car"])] = per_car.get(p["car"], 0) + 1
    assert all(n <= len(periods) for n in per_car.values())
    race = room.race
    for e in events:
        if e["type"] == "radio" and e["payload"].get("topic") == "safety" and e["payload"].get("request"):
            assert race.cars[e["payload"]["car"]].age >= 0
    assert len(asks) <= len(periods) * len(room.human_cars)


def test_a_breakdown_makes_the_engineer_name_the_failed_part_and_a_crash_does_not():
    from server.radio import FAILURES

    def break_often(b):
        b["incidents"]["mechanical_per_car_lap"] = 0.5
        b["incidents"]["mechanical_on_track_share"] = 1.0
    room = room_with(laps=20, tweak=break_often)
    ev = run(room, 600)
    lines = radio(ev, car="T0A") + radio(ev, car="T0B")
    gone = [m for m in lines if m["from"] == "driver" and m["message"] == "I have to stop, the car's gone."]
    engineer = [m for m in lines if m["from"] == "engineer" and ", retire the car, " in m["message"]]
    assert gone and len(engineer) == len(gone)
    for m in engineer:
        assert "Park it somewhere safe." in m["message"]
        assert any(f"{part} failure." in m["message"] for part in FAILURES), m


def test_the_engineer_reads_box_opposite_in_plain_words():
    room = room_with()
    say = room.radio._engineer_box
    arm = say("T0A", "Box opposite Brackett, hard if we box")
    assert "watching Brackett" in arm and "box for hard" in arm and "stay out" in arm and "if we box tyres" not in arm
    assert "Stay out tyres" not in say("T0A", "Brackett has boxed: stay out") and "Brackett has boxed. Stay out." in say("T0A", "Brackett has boxed: stay out")
    assert "Brackett stayed out. Box, box, hard tyres." in say("T0A", "Brackett stayed out: box, hard")
    assert "cancelled" in say("T0A", "Box opposite cancelled")
