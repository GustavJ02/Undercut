"""Actions a team can send (design section 7). The same objects come from humans and from AI policies."""
from dataclasses import dataclass


@dataclass(frozen=True)
class SetStartTyres:
    car: str
    compound: str


@dataclass(frozen=True)
class CallBox:
    car: str
    compound: str


@dataclass(frozen=True)
class CancelBox:
    car: str


@dataclass(frozen=True)
class BoxOpposite:
    """"Box opposite COV": `car` decides at its own pit entry. If `target` (a rival ahead) has gone into the pits it stays out,
    if not it boxes for `compound`. No calling cutoff applies: the driver sees what the rival did at the last moment."""
    car: str
    target: str
    compound: str


@dataclass(frozen=True)
class SwapPositions:
    """Team order: `car` (the leading car of the two) lets `with_car` (the one behind) past, at the place the strategist names.

    anchor is "asap", "before" or "after"; before/after refer to `turn`: the approach to that corner (usually a straight) or
    the exit onto the stretch after it."""
    car: str
    with_car: str
    anchor: str = "asap"
    turn: int | None = None


@dataclass(frozen=True)
class CancelSwap:
    """Call off a pending swap order of `car` (the yielding car)."""
    car: str


def action_from_payload(p: dict):
    """Rebuild an action from a logged `action` event payload (replays and the debrief)."""
    kind = p["kind"]
    if kind == "CallBox":
        return CallBox(p["car"], p["compound"])
    if kind == "BoxOpposite":
        return BoxOpposite(p["car"], p["target"], p["compound"])
    if kind == "CancelBox":
        return CancelBox(p["car"])
    if kind == "CancelSwap":
        return CancelSwap(p["car"])
    if kind == "SwapPositions":
        return SwapPositions(p["car"], p["with_car"], p.get("anchor", "asap"), p.get("turn"))
    raise ValueError(f"unknown action kind {kind!r}")
