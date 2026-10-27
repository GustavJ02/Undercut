"""World state: the hidden truth of a race (design section 5). Positions are `progress`, in laps from the start line."""
import copy
import math
from dataclasses import dataclass, field

import numpy as np

from engine.weather import lap_delta, wear_factor

COMPOUNDS = ("SOFT", "MEDIUM", "HARD")                 # the dry compounds the strategy plans are made of
WET_COMPOUNDS = ("INTERMEDIATE", "WET")
ALL_COMPOUNDS = COMPOUNDS + WET_COMPOUNDS
MAX_STOPS = 8       # stops per car for which random draws are made up front


@dataclass
class Car:
    id: str
    team: str
    driver: str
    pace_s: float                       # hidden: team plus driver delta against the field median
    compound: str
    sets: dict                          # fresh sets left per compound, after the one on the car
    cliff_onset: float                  # hidden: tyre age at which the cliff starts for the current set
    progress: float = 0.0
    lap: int = 0                        # laps completed
    age: int = 0                        # laps on the current set
    lt: float = 0.0                     # hidden: lap time potential of the current lap, s
    pace_now: float = 0.0               # hidden: the same without the lap's random noise, what passing compares
    lap_start_t: float = 0.0
    last_lap_s: float | None = None
    status: str = "RUNNING"             # RUNNING | IN_PIT | FINISHED | RETIRED
    stops: int = 0
    compounds_used: list = field(default_factory=list)
    box_call: dict | None = None        # {compound, effective_lap}
    opposite: dict | None = None        # {target, compound, stops}: a "box opposite" call, settled at this car's pit entry
    pit: dict | None = None             # {exit_progress, rate}
    finish_t: float | None = None
    breach: bool = False                # two-compound rule broken at the finish
    stint_s: float = 0.0                # hidden: this stint's pace offset (stint-to-stint variation)
    launch_at: float = 0.0              # hidden: time after lights out at which the car starts to move, s
    launch_tau: float = 0.0             # hidden: launch time constant, s
    swap_refused: dict | None = None    # the last swap call this driver refused: {rear, t}
    swap: dict | None = None            # a pending order to let the team mate by (engine/orders.py)
    hold_until: float = 0.0             # after yielding by order the car does not attack straight back
    hold_for: str | None = None
    restart_k: int | None = None        # the start line this car restarted behind: crossing it again is not a new lap
    p0: float = 0.0                     # progress at the start of the tick, so gaps are measured at one instant
    damage_s: float = 0.0               # hidden: pace lost per lap to contact damage
    retired_t: float | None = None
    retired_where: str | None = None    # "track" or "pit"


@dataclass
class Race:
    seed: int
    dt: float
    total_laps: int
    circuit: dict                       # the bundle's circuit block
    bundle: dict
    cars: dict                          # id -> Car, in grid order
    draws: dict                         # pre-drawn random numbers, see setup.build_race
    tick: int = 0
    session: str = "GRID"               # GRID | RACING | SC | VSC | FINISHED
    safety: dict | None = None          # {kind, start_progress, duration_laps}
    safety_count: int = 0
    green_line: float = float("-inf")              # a car may overtake again once it has crossed this lap line (the green flag line after a safety car)
    leader_finished: bool = False
    events: list = field(default_factory=list)
    circuit_name: str = ""
    mult: dict = field(default_factory=dict)    # chaos multipliers, see engine.setup.DEFAULT_MULTIPLIERS
    exposure_s: float = 0.0             # car-seconds spent within contact range, for calibrating the contact rate
    grid: list = field(default_factory=list)
    weather: dict | None = None        # hidden weather truth, see engine/weather.py
    red: dict | None = None            # a red flag in progress: {"hold": ticks left}
    restart_t: float | None = None     # time of the last standing restart after a red flag
    final_order: list | None = None    # the official classification (penalties applied), set when the race ends
    draw_dims: tuple | None = None     # (ticks, laps) the draws cover, kept when a branch is stored without them (scoring/debrief.py)
    pub_cache: tuple | None = None     # what every team sees this tick, see server/visibility.py (cleared by tick())
    team_unreliability: dict = field(default_factory=dict)    # team id -> unreliability relative to the field mean

    def time(self) -> float:
        return self.tick * self.dt

    def order(self):
        """Car ids from first to last: by distance covered, so a lapped car that has already crossed the line after the leader
        finished does not rank above a lead-lap car still on its last lap. A finished car counts its completed laps, ties go to
        the one that finished first; retirements come last."""
        if self.session == "GRID":
            return list(self.grid)
        if self.final_order is not None:
            return list(self.final_order)
        live = (c for c in self.cars.values() if c.status != "RETIRED")
        dist = lambda c: float(c.lap) if c.status == "FINISHED" else c.progress
        ranked = sorted(live, key=lambda c: (-dist(c), c.finish_t if c.finish_t is not None else math.inf, c.id))
        out = sorted((c for c in self.cars.values() if c.status == "RETIRED"), key=lambda c: (-c.lap, -c.retired_t, c.id))
        return [c.id for c in ranked + out]

    def copy(self):
        """Independent copy for what-if re-simulation; the draws are shared because they are never written."""
        draws, self.draws = self.draws, None
        try:
            other = copy.deepcopy(self)
        finally:
            self.draws = draws
        other.draws = draws
        return other


def set_lap_time(car: Car, race: Race, lap_index: int):
    """Set the potential of the lap that starts now: with its noise for the clock, without it for pass decisions."""
    noise = race.draws["car"][car.id]["lap_noise"][max(lap_index, 0)]
    car.pace_now = lap_time_potential(car, race, 0.0)
    car.lt = car.pace_now + noise


def lap_time_potential(car: Car, race: Race, lap_noise: float) -> float:
    """The lap model: base + compound offset + wear * age - fuel * lap, plus the cliff and the lap's noise.
    Track temperature is held at the fitted reference, so the temperature term is zero."""
    b = race.bundle
    comp = b["compounds"][car.compound]
    wear = comp["wear_s_per_lap"] * (wear_factor(race, car.compound) if race.weather else 1.0)
    lt = race.circuit["base_lap_s"] + car.pace_s + comp["pace_offset_s"] + wear * car.age \
        - b["fuel_s_per_lap"] * car.lap + (lap_delta(race, car.compound) if race.weather else 0.0)
    lt += comp["cliff"]["extra_s_per_lap"] * max(0.0, car.age - car.cliff_onset)
    return lt + car.damage_s + car.stint_s + lap_noise


def tyre_loss_s(car: Car, race: Race) -> float:
    """Seconds per lap lost to wear and cliff on the current set, against a new tyre of the same compound."""
    comp = race.bundle["compounds"][car.compound]
    return comp["wear_s_per_lap"] * car.age + comp["cliff"]["extra_s_per_lap"] * max(0.0, car.age - car.cliff_onset)


def cliff_onset_from_uniform(compound_block: dict, u: float) -> float:
    cliff = compound_block["cliff"]
    return float(np.interp(u, cliff["onset_cdf"], cliff["onset_age"]))
