// Mirrors server/protocol.py and server/visibility.py. The client only ever sees this: the visible state of its own team.
export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export const DRY_COMPOUNDS: Compound[] = ["SOFT", "MEDIUM", "HARD"];
export const COMPOUNDS: Compound[] = [...DRY_COMPOUNDS, "INTERMEDIATE", "WET"];
export type Session = "GRID" | "RACING" | "SC" | "VSC" | "RED" | "FINISHED";

export interface CarRow {
  id: string;
  team: string;
  driver: string;
  position: number;
  lap: number;
  lap_frac: number;
  status: "RUNNING" | "IN_PIT" | "FINISHED" | "RETIRED";
  compound: Compound;
  tyre_age: number;
  stops: number;
  compounds_used: Compound[];
  sets_remaining: Partial<Record<Compound, number>>;
  last_lap_s: number | null;
  gap_to_leader_s: number | null;
  interval_s: number | null;
  laps_down: number;
  /** Classified last for not using two compounds: its gap is a race time, not a place. */
  penalised?: boolean;
}

export interface Swap {
  with: string;
  anchor: "asap" | "before" | "after";
  turn: number | null;
  phase: "asked" | "waiting" | "lifting";
}

export interface OwnCar {
  est_tyre_loss_s: number;
  /** Pace lost to the car in front now, and to damage: the team's own telemetry. */
  dirty_air_loss_s?: number;
  damage_loss_s?: number;
  box_call: { compound: Compound; effective_lap: number } | null;
  /** A team order in progress, keyed by the yielding (leading) car. */
  swap?: Swap | null;
  /** A "box opposite" call: at its own pit entry the driver does the opposite of the rival ahead. */
  order?: Order | null;
}

export interface Order {
  target: string;
  compound: Compound;
}

export interface Corner {
  n: number;
  frac: number; // fraction of the lap, same origin as lap_frac
}

export interface View {
  time_s: number;
  session: Session;
  track_status: "AllClear" | "SCDeployed" | "VSCDeployed" | "Red";
  race_lap: number;
  total_laps: number;
  cars: CarRow[];
  own: Record<string, OwnCar>;
  weather: Weather | null;
  /** The safety car while it is on the track: it leaves the pit exit, leads the field, and goes in at the pit entry. */
  safety_car?: { lap_frac: number } | null;
}

export interface Weather {
  raining: boolean;
  track: "dry" | "damp" | "wet";
  wet_race_declared: boolean;
  forecast_pre_race_pct: number;
  forecast_next_laps: number[];
}

export interface Clock {
  time_s: number;
  tick: number;
  speed: number;
  paused: boolean;
  pause_allowed: boolean;
  session: Session;
  multiplayer?: boolean;
  players?: Player[];
  /** Multiplayer: a speed increase waiting for everyone, and the last thing to tell the players about the speed (shown once per id). */
  vote?: SpeedVote | null;
  vote_note?: { id: number; text: string };
}

export interface SpeedVote {
  by: string; // team id
  by_name: string;
  to: number;
  waiting: string[]; // team ids that have not said yes
  waiting_names: string[];
}

export interface Player {
  team: string;
  name: string;
  connected: boolean;
  auto: boolean;
  host: boolean;
}

/** One lap of public timing: lap number, time, tyre, tyre age, and flags (P stopped this lap, S/V/R safety car, VSC, red flag). */
export type LapRow = [lap: number, time_s: number, compound: Compound, age: number, flags: string];
export type LapTable = Record<string, LapRow[]>;

export interface RaceInfo {
  id: string;
  multiplayer?: boolean;
  host?: string | null;
  players?: Player[];
  circuit: string;
  total_laps: number;
  /** The circuit's full race distance; `total_laps` is shorter in a short race. */
  full_laps?: number;
  human_team: string;
  human_cars: string[];
  corners?: Corner[];
  pit_loss_s?: number;
  /** What a stop costs under a safety car and under a VSC (the same stop, with the field slowed). */
  pit_loss_sc_s?: number;
  pit_loss_vsc_s?: number;
  /** How close the two cars must be for a team order. */
  swap_window_s?: number;
  /** Fraction of the lap after which a pit call counts for the next lap instead of this one. */
  pit_call_deadline_frac?: number;
  traffic_window_s?: number;
  fuel_s_per_lap?: number;
  sc_rate_per_lap?: number;
  lap_length_m?: number;
  tyre_guide?: TyreGuide;
}

/** Fitted averages of the dry compounds, public before the race (not any car's own wear or cliff). */
export interface CompoundGuide {
  pace_s: number; // per lap against the medium, negative is faster
  wear_s_per_lap: number;
  cliff_s_per_lap: number;
  cliff_age: number[]; // where the cliff may start, with its cumulative probability
  cliff_cdf: number[];
}
export interface TyreGuide {
  compounds: Record<"SOFT" | "MEDIUM" | "HARD", CompoundGuide>;
  stops: Record<string, number>; // number of stops -> finishers in simulated races
}

export interface GameEvent {
  tick: number;
  type: string;
  payload: Record<string, unknown>;
}

export type ServerMessage =
  | { type: "snapshot"; info: RaceInfo; view: View; clock: Clock; history: GameEvent[]; laps?: LapTable }
  | { type: "state"; view: View }
  | { type: "event"; event: GameEvent }
  | { type: "clock" } & Clock
  | { type: "error"; message: string };

export interface TeamOption {
  id: string;
  name: string;
  drivers: { id: string; name: string }[];
}

export interface Options {
  bundle_version: string;
  circuits: Record<string, number>;
  teams: TeamOption[];
  speeds: number[];
  circuit_info?: Record<string, { lap_length_m: number; corners: number; sc_rate_per_lap: number }>;
}

// Debrief report (scoring/debrief.py)
export interface DebriefOption {
  id: string;
  name: string; // what a player calls it: "Box soft", "Stay out"
  taken: boolean;
  default: boolean; // the default strategy's start tyre (only on a start decision)
  points: number;
  /** Paired difference from the taken option, with its standard error; places gained is positive when the option finishes higher. */
  delta_points: number;
  delta_points_se: number;
  places: number;
  places_se: number;
  verdict: "taken" | "better" | "worse" | "same";
}

export interface DebriefDecision {
  index: number;
  kind: "start" | "call" | "safety" | "swap";
  car: string;
  lap: number;
  tick: number;
  call: string; // the taken option's name
  value_after: number; // V_k: expected points with your calls up to here and the default strategy after
  contribution_points: number; // V_k - V_(k-1); these add up to skill
  contribution_points_se: number;
  contribution_places: number;
  contribution_places_se: number;
  best: string; // id of the best option
  miss_points: number; // the best option's advantage over the taken one: these do not add up
  miss_places: number;
  significant: boolean; // the best option is clearly better than the taken one
  options: DebriefOption[]; // the taken option first
}

export interface DebriefDriver {
  car: string;
  actual_position: number;
  actual_points: number;
  expected_position: number;
  expected_points: number;
  baseline_position: number;
}

export interface DebriefSummary {
  actual_points: number;
  actual_position: number;
  baseline_points: number;
  baseline_points_se: number;
  expected_points: number; // V_K
  expected_points_se: number;
  expected_points_sd: number; // a normal swing
  skill_points: number; // V_K - V_0, the sum of the contributions
  skill_points_se: number;
  skill_places: number;
  skill_places_se: number;
  luck_points: number; // actual - V_K
  /** The strategist score: 0 to 100, 50 = as good as the AI would have been with the same cars; low and high are one standard error of the skill. */
  score: number;
  score_low: number;
  score_high: number;
  /** Places and points the two-compound penalty cost, counted against the score (not stopping is no call, so skill alone would miss it). */
  penalty_places: number;
  penalty_points: number;
  baseline_position: number;
  expected_position: number;
  drivers: DebriefDriver[];
  biggest_miss: number | null; // a decision's index
  worst_contribution: number | null;
}

export interface DebriefReport {
  team: string;
  cars: string[];
  futures: number;
  decisions: DebriefDecision[];
  penalties: { car: string; reason: string; effect: string }[];
  summary: DebriefSummary;
}

/** One strategist of a finished multiplayer game (server /api/games/<code>/ranking). */
export interface RankedPlayer {
  team: string;
  name: string;
  score: number;
  score_low: number;
  score_high: number;
  skill_places: number;
  skill_points: number;
  actual_position: number;
  actual_points: number;
  cars: string[];
}

export type RankingStatus =
  | { status: "not started" }
  | { status: "running"; progress: [number, number] }
  | { status: "error"; error: string }
  | { status: "done"; ranking: RankedPlayer[]; winner: string | null };

export type DebriefStatus =
  | { status: "not started" }
  | { status: "running"; progress: [number, number] }
  | { status: "error"; error: string }
  | { status: "done"; report: DebriefReport };

// Team radio (server/radio.py): own-team events only.
export type RadioTopic = "tyres" | "weather" | "track" | "car" | "pace";
export const RADIO_TOPICS: { topic: RadioTopic; label: string }[] = [
  { topic: "tyres", label: "Tyres" },
  { topic: "weather", label: "Weather" },
  { topic: "track", label: "Track and traffic" },
  { topic: "car", label: "Car" },
  { topic: "pace", label: "Pace" },
];

export interface RadioRequest {
  kind: "box" | "swap";
  label: string;
  expires: number; // race seconds, compare with view.time_s
}

export interface RadioLine {
  id: number;
  tick: number;
  car: string;
  from: "driver" | "engineer";
  speaker: string;
  message: string;
  topic: string;
  reply_to: number | null;
  request: RadioRequest | null;
}
