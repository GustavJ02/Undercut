/** The part of the server's messages the renderer may use: only the fields marked `read` in `contract.ts`. Everything else the
 * server sends (driver names, tyre estimates, sets left, ...) is invisible to presentation code at compile time. */
export type Session = "GRID" | "RACING" | "SC" | "VSC" | "RED" | "FINISHED";
export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type CarStatus = "RUNNING" | "IN_PIT" | "FINISHED" | "RETIRED";

export interface ContractCar {
  id: string;
  team: string;
  position: number;
  lap: number;
  lap_frac: number;
  status: CarStatus;
  compound: Compound;
  tyre_age: number;
  stops: number;
  gap_to_leader_s: number | null;
  interval_s: number | null;
}

export interface ContractView {
  time_s: number;
  session: Session;
  track_status: "AllClear" | "SCDeployed" | "VSCDeployed" | "Red";
  race_lap: number;
  total_laps: number;
  cars: ContractCar[];
  own: Record<string, { box_call: { compound: Compound; effective_lap: number } | null }>;
  weather?: { raining: boolean; track: "dry" | "damp" | "wet" } | null;
  /** The safety car while it is on the track, else null. */
  safety_car?: { lap_frac: number } | null;
}

export interface ContractClock {
  time_s: number;
  tick: number;
  speed: number;
  paused: boolean;
  session: Session;
}

export interface ContractInfo {
  circuit: string;
  total_laps: number;
  human_team: string | null;
  human_cars: string[];
  corners?: { n: number; frac: number }[];
}

export interface ContractEvent {
  tick: number;
  type: string;
  payload: Record<string, unknown>;
}
