"""Team orders: swapping positions on the strategist's call (design section 7).

The call names the car that yields, the car that is to get by, and where: as soon as possible, or before / after a numbered
corner. A zone is a stretch of the lap: "before Turn X" is the approach to the corner (from the previous corner's exit to its
braking), "after Turn X" is its exit up to the next corner. Inside the zone the yielding car lifts, the other car closes up and
goes by, and the cost is whatever that takes: a lift on a straight closes the gap fast, one in a corner barely changes anyone's
speed. If the zone ends without a pass (the gap was too big) the order lapses and the strategist has to call again. All the
numbers are placeholders (`team_orders` in the bundle): nothing in the timing feed shows team orders.
"""

ANCHORS = ("asap", "before", "after")


def _corners(race):
    return race.circuit["corners"]


def zone(race, anchor: str, turn):
    """(start, end) of the stretch in lap fractions, or None for "as soon as possible". May start below 0 or end above 1."""
    if anchor == "asap":
        return None
    cs = _corners(race)
    cfg = race.bundle["team_orders"]
    i = next(k for k, c in enumerate(cs) if c["n"] == turn)
    hw = cfg["corner_halfwidth"]
    if anchor == "before":
        prev = cs[i - 1]["frac"] - (1.0 if i == 0 else 0.0)
        return prev + hw, cs[i]["frac"] - hw
    nxt = cs[(i + 1) % len(cs)]["frac"] + (1.0 if i == len(cs) - 1 else 0.0)
    return cs[i]["frac"] + hw, nxt - hw


def _in_zone(z, frac: float) -> bool:
    return any(z[0] <= f < z[1] for f in (frac - 1.0, frac, frac + 1.0))


def segment_kind(race, frac: float) -> str:
    """Where a car is: in a corner, on a straight (a long stretch between corners) or on a short link."""
    cs, cfg = _corners(race), race.bundle["team_orders"]
    marks = [c["frac"] for c in cs]
    for m in marks:
        if min(abs(frac - m), 1.0 - abs(frac - m)) <= cfg["corner_halfwidth"]:
            return "corner"
    nxt = min((m for m in marks if m > frac), default=marks[0] + 1.0)
    prev = max((m for m in marks if m <= frac), default=marks[-1] - 1.0)
    return "straight" if nxt - prev >= cfg["straight_min_gap"] else "link"


_ARGUMENTS = ["I'm the quicker one out here, are you sure?", "Why? I can still catch the cars ahead.",
              "I don't agree with this one, I'm pushing.", "Give me a couple more laps, the tyres are fine."]


def _label(anchor, turn):
    return "as soon as possible" if anchor == "asap" else f"{anchor} Turn {turn}"


def _surname(car):
    return car.driver.split()[-1]


def request(race, action, ev, emit, draw):
    """Validate a swap call and set it up on the yielding car. `emit(type, **payload)` records events, `draw(row)` is a
    pre-drawn uniform for the delay. Returns nothing: the answer goes out as a `swap_ack` event."""
    front, rear = race.cars.get(action.car), race.cars.get(action.with_car)
    cfg = race.bundle["team_orders"]

    def no(message):
        emit("swap_ack", car=action.car, ok=False, message=message)

    if front is None or rear is None or front is rear:
        return no("unknown cars")
    if action.anchor not in ANCHORS:
        return no("choose as soon as possible, before or after a turn")
    if action.anchor != "asap" and action.turn not in {c["n"] for c in _corners(race)}:
        return no(f"there is no Turn {action.turn} here")
    if race.session != "RACING":
        return no("no swap under a safety car, VSC or red flag, or before the start")
    if front.status != "RUNNING" or rear.status != "RUNNING":
        return no("both cars must be running on track")
    running = sorted((c for c in race.cars.values() if c.status == "RUNNING"), key=lambda c: (-c.progress, c.id))
    if running.index(rear) != running.index(front) + 1:
        return no(f"{_surname(rear)} is not directly behind {_surname(front)}")
    gap = (front.progress - rear.progress) * rear.lt
    if gap > cfg["window_s"]:
        return no(f"the cars are {gap:.1f} s apart: a swap needs them within {cfg['window_s']:.0f} s")
    if front.swap is not None:
        return no("a swap is already ordered")
    if race.total_laps - front.lap <= 2:
        return no("too late in the race to swap")
    now = race.time()
    delay, argued = 0.0, False
    refused = front.swap_refused
    insisting = refused is not None and refused["rear"] == rear.id and now - refused["t"] <= cfg["insist_window_s"]
    if not insisting and draw(7) < cfg["argue_prob"]:            # the driver pushes back on the call
        if draw(8) < cfg["refuse_share"]:
            front.swap_refused = {"rear": rear.id, "t": now}
            emit("radio", car=front.id, message=f"{_surname(front)}: {_ARGUMENTS[int(draw(6) * len(_ARGUMENTS))]}")
            return no(f"{_surname(front)} refuses for now: call again to insist")
        delay, argued = 5.0 + draw(6) * (cfg["delay_max_s"] - 5.0), True
    elif draw(5) < cfg["delay_prob"]:
        delay = 5.0 + draw(6) * (cfg["delay_max_s"] - 5.0)
    front.swap_refused = None
    front.swap = {"rear": rear.id, "anchor": action.anchor, "turn": action.turn, "zone": zone(race, action.anchor, action.turn),
                  "asked_at": now, "active_at": now + delay, "entered": False}
    emit("swap_ack", car=front.id, ok=True, message=f"Understood: {_surname(front)} lets {_surname(rear)} by "
                                                     f"{_label(action.anchor, action.turn)}")
    if argued:
        emit("radio", car=front.id, message=f"{_surname(front)}: {_ARGUMENTS[int(draw(6) * len(_ARGUMENTS))]} Fine, I'll do it")
    elif delay:
        emit("radio", car=front.id, message=f"{_surname(front)}: Can you confirm that? I'll do it in a moment")


def cancel(race, car, emit):
    """Call off the pending swap of the yielding car."""
    if car is None or car.swap is None:
        return emit("swap_ack", car=car.id if car else None, ok=False, message="there is no swap to cancel")
    car.swap = None
    emit("swap_ack", car=car.id, ok=True, message="Swap cancelled: carry on as you were")


def step(race, car, ev, emit) -> float:
    """Advance a pending swap on the yielding car by one tick. Returns the seconds per lap the car is giving away now."""
    sw = car.swap
    if sw is None:
        return 0.0
    rear, cfg, now = race.cars[sw["rear"]], race.bundle["team_orders"], race.time()
    if rear.progress >= car.progress and rear.status == "RUNNING":
        car.swap = None                                              # they swapped some other way
        return 0.0
    if race.session != "RACING" or car.status != "RUNNING" or rear.status != "RUNNING":
        car.swap = None
        emit("swap_cancelled", car=car.id, message="The swap is off: conditions changed")
        return 0.0
    if now < sw["active_at"]:
        return 0.0
    frac = car.progress % 1.0
    where = _label(sw["anchor"], sw["turn"])
    if sw["zone"] is None:
        if now - sw["active_at"] > cfg["timeout_s"]:
            car.swap = None
            emit("swap_failed", car=car.id, message=f"{_surname(car)} could not let {_surname(rear)} by: call again")
            return 0.0
    elif _in_zone(sw["zone"], frac):
        sw["entered"] = True
    elif sw["entered"]:
        car.swap = None
        emit("swap_failed", car=car.id, message=f"Not done {where}: the gap was too big. Call again")
        return 0.0
    elif now - sw["asked_at"] > cfg["timeout_s"] + 2 * car.lt:
        car.swap = None
        emit("swap_failed", car=car.id, message=f"Not done {where}: the place never came up. Call again")
        return 0.0
    if sw["zone"] is not None and not sw["entered"]:
        return 0.0
    sw["entered"] = True
    return float(cfg["lift_s_per_lap"][segment_kind(race, frac)])


def forced_pass(race, car, ahead, gap_s: float) -> bool:
    """Is `ahead` (the car in front of `car`) yielding to it by order, already lifting, and has `car` closed right up?"""
    sw = ahead.swap
    close = race.bundle["traffic"]["min_gap_s"] * 1.2
    return sw is not None and sw["rear"] == car.id and sw["entered"] and gap_s <= close


def complete(race, front, rear, emit):
    """The pass has happened: close the order and keep the yielded car from attacking straight back."""
    kind = segment_kind(race, rear.progress % 1.0)
    front.swap = None
    front.hold_until, front.hold_for = race.time() + race.bundle["team_orders"]["hold_s"], rear.id
    emit("swap_done", car=front.id, with_car=rear.id, kind=kind, lap=rear.lap + 1,
         message=f"{_surname(rear)} is through ({kind})")
