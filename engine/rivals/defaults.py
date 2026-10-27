"""Tunable knobs of the rule-based rivals (design section 11). These are design choices, not fitted values."""
from engine.rng import stream

DECIDE_EVERY_S = 5.0            # how often a policy looks at the race
UNDERCUT_MARGIN_S = 3.0         # a rival this close behind, beyond the pit loss, threatens an undercut
UNDERCUT_MIN_AGE_SHARE = 0.4    # only cover an undercut once the tyres have done this share of the planned stint
TYRE_LOSS_PIT_S = 1.8           # pit when the estimated tyre loss per lap exceeds this
RAIN_LOOKAHEAD_LAPS = 6         # laps of the forecast a team counts when it weighs a change to intermediates
INTER_GAIN_MARGIN = 1.5         # the time intermediates must save over those laps, as a multiple of the pit loss
SAFETY_PIT_SHARE = 0.45         # under SC/VSC pit if the tyres have done this share of the planned stint (adjusted by aggression)
MISTAKE_RATE = 0.06             # per decision, scaled by (1 - quality)


def team_traits(seed: int, team_id: str) -> dict:
    """Per-team aggression, quality and undercut sensitivity, reproducible from the seed."""
    r = stream(seed, "team_traits", team_id)
    return {"aggression": float(r.uniform(0.2, 0.8)), "quality": float(r.uniform(0.7, 0.98)),
            "undercut_sensitivity": float(r.uniform(0.3, 0.9))}
