"""Messages between server and client (design section 16) and the checks on what a client may send.

Server to client: `snapshot` (full visible state, on connect and reconnect), `state` (visible state after some ticks), `event`
(one discrete event the team may see), `clock` (sim time, speed, paused). Client to server: `action` and `control`. A client
only ever acts for its own team; anything else is answered with an `error` message, never applied.
"""
from engine.actions import BoxOpposite, CallBox, CancelBox, CancelSwap, SetStartTyres, SwapPositions

COMPOUNDS = ("SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET")
SPEEDS = (1, 2, 5, 10)


class ProtocolError(ValueError):
    pass


def parse_action(msg: dict, team_cars: set):
    """Turn a client `action` message into an engine action, or raise ProtocolError."""
    kind, car = msg.get("kind"), msg.get("car")
    if car not in team_cars:
        raise ProtocolError(f"{car!r} is not one of your cars")
    if kind in ("CallBox", "SetStartTyres"):
        compound = msg.get("compound")
        if compound not in COMPOUNDS:
            raise ProtocolError(f"unknown compound {compound!r}")
        return CallBox(car, compound) if kind == "CallBox" else SetStartTyres(car, compound)
    if kind == "BoxOpposite":
        target, compound = msg.get("target"), msg.get("compound")
        if not isinstance(target, str) or target in team_cars:
            raise ProtocolError("name a rival car to watch")
        if compound not in COMPOUNDS:
            raise ProtocolError(f"unknown compound {compound!r}")
        return BoxOpposite(car, target, compound)
    if kind == "CancelBox":
        return CancelBox(car)
    if kind == "CancelSwap":
        return CancelSwap(car)
    if kind == "SwapPositions":
        with_car, anchor, turn = msg.get("with_car"), msg.get("anchor", "asap"), msg.get("turn")
        if with_car not in team_cars or with_car == car:
            raise ProtocolError(f"{with_car!r} is not your other car")
        if anchor not in ("asap", "before", "after"):
            raise ProtocolError("anchor must be asap, before or after")
        if anchor != "asap" and not isinstance(turn, int):
            raise ProtocolError("name the turn")
        return SwapPositions(car, with_car, anchor, turn if anchor != "asap" else None)
    raise ProtocolError(f"unknown action {kind!r}")


def parse_radio(msg: dict, team_cars: set):
    """Turn a client `radio` message into ("ask", car, topic) or ("reply", id, answer), or raise ProtocolError."""
    op = msg.get("op")
    if op == "ask":
        car = msg.get("car")
        if car not in team_cars:
            raise ProtocolError(f"{car!r} is not one of your cars")
        return "ask", car, msg.get("topic")
    if op == "reply":
        if not isinstance(msg.get("id"), int):
            raise ProtocolError("reply to a request by its id")
        return "reply", msg["id"], msg.get("answer")
    raise ProtocolError(f"unknown radio operation {op!r}")


def parse_control(msg: dict):
    op = msg.get("op")
    if op in ("pause", "resume", "start"):
        return op, None
    if op == "vote":
        if msg.get("answer") not in ("yes", "no"):
            raise ProtocolError("answer the speed vote with yes or no")
        return op, msg["answer"] == "yes"
    if op == "speed":
        if msg.get("value") not in SPEEDS:
            raise ProtocolError(f"speed must be one of {SPEEDS}")
        return op, msg["value"]
    raise ProtocolError(f"unknown control {op!r}")


def clock_message(room) -> dict:
    return {"type": "clock", "time_s": room.race.time(), "tick": room.race.tick, "speed": room.speed, "paused": room.paused,
            "pause_allowed": room.pause_allowed, "session": room.race.session, "multiplayer": room.multiplayer,
            "players": room.players(), "vote": room.vote_view(), "vote_note": room.vote_note}
