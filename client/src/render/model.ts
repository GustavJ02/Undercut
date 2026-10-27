/** The render model: a pure function of the visible state, the public events and the active content pack (design section 2).
 *
 * Nothing here touches the engine, the clock or randomness, and the output is built field by field from the contract's `read`
 * fields, never by copying objects, so a field the server adds (or leaks) cannot reach the scene. Display names, colours and
 * numbers come from the pack through stable ids. `interpolate` is the 60 fps half: it moves cars between states.
 */
import type { ContractCar, ContractClock, ContractEvent, ContractInfo, ContractView, CarStatus, Compound, Session } from "../contract/types";
import type { Resolver } from "../packs/resolve";
import type { Pattern } from "../packs/types";

export const RENDER_CONTRACT = 1;
/** A car further apart than this between two states (a lap wrap is fine, a restart line-up is not) is not given a speed. */
export const MAX_STEP = 0.2;
/** A local yellow keeps the lighting yellow for this long, in sim seconds: the feed names no end for it. */
export const YELLOW_HOLD_S = 25;

export type Lighting = "green" | "yellow" | "sc" | "vsc" | "red" | "chequered";

export interface LiveryParams {
  primary: string;
  secondary: string;
  accent: string;
  pattern: Pattern;
  number: number;
  image?: string;
}

export interface RenderCar {
  id: string;
  teamId: string;
  num: number;
  lapFrac: number; // 0..1 at the newest state
  speed: number; // lap fractions per sim second, derived from successive states
  status: CarStatus;
  compound: Compound;
  position: number;
  livery: LiveryParams;
}

export type CueType =
  | "lightsOut" | "passBy" | "pitCall" | "pitIn" | "pitOut" | "scDeployed" | "vscDeployed" | "greenFlag" | "redFlag"
  | "scEnding" | "restart" | "retire" | "contact" | "yellow" | "finish" | "win" | "radio";

/** A one-shot trigger for animation and sound. `id` is unique for the life of a race, so a consumer fires each cue once. */
export interface Cue {
  id: string;
  type: CueType;
  tick: number;
  car?: string;
  other?: string;
  /** pitIn: the compound being fitted. */
  compound?: Compound;
}

export interface WeatherFx {
  raining: boolean;
  track: "dry" | "damp" | "wet";
}

/** A faster car about to lap a slower one: shown on the LED boards as a blue flag. */
export interface BlueFlag {
  lapped: string;
  by: string;
}

/** How close behind the slower car (as a share of a lap, about three seconds) the faster car has to be, and where the slower car is on the
 * lap (the last quarter and the start of it, the main straight), for the boards to flash blue. */
export const BLUE_WINDOW = 0.04;
export const STRAIGHT = { from: 0.78, to: 0.07 };

export interface PitActivity {
  car: string;
  teamId: string;
  sinceT: number; // sim time the car was first seen in the pit lane; the phase inside the lane needs request R2
}

export interface RenderModel {
  contract: typeof RENDER_CONTRACT;
  t: number;
  tick: number;
  stateIntervalS: number; // sim time between the last two states: how far `interpolate` may run ahead
  session: Session;
  lighting: Lighting;
  yellowUntilT: number;
  lap: number;
  totalLaps: number;
  circuit: string;
  safetyEnding: boolean; // race control has announced the end of the current safety car or VSC
  blue: BlueFlag[];
  safetyCar: { lapFrac: number; speed: number } | null; // the safety car while it is on the track
  weather: WeatherFx; // what can be seen from the pit wall: rain and the state of the track (the forecast is not part of it)
  corners: { n: number; frac: number }[]; // turn numbers and where they are on the lap; empty when the server sends none
  cars: RenderCar[]; // sorted by id, a stable order
  pitLane: PitActivity[];
  cues: Cue[]; // the cues of the events that arrived with this state
  mine: string[];
}

export interface RenderInput {
  view: ContractView;
  clock: Pick<ContractClock, "tick" | "speed" | "paused">;
  info: ContractInfo;
  events: ContractEvent[];
}

const COMPOUND_NAMES: unknown[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The cues for one event, or none for events the scene does not act on. */
export function cuesFor(e: ContractEvent, winner?: string): Omit<Cue, "id">[] {
  const p = e.payload;
  const base = { tick: e.tick };
  switch (e.type) {
    case "lights_out": return [{ ...base, type: "lightsOut" }];
    case "pass": return [{ ...base, type: "passBy", car: str(p.car), other: str(p.passed) }];
    case "box_ack": return p.ok === true ? [{ ...base, type: "pitCall", car: str(p.car) }] : [];
    case "pit_in": return [{ ...base, type: "pitIn", car: str(p.car), compound: COMPOUND_NAMES.includes(p.compound as Compound) ? (p.compound as Compound) : undefined }];
    case "pit_out": return [{ ...base, type: "pitOut", car: str(p.car) }];
    case "safety_deployed": return [{ ...base, type: p.kind === "SC" ? "scDeployed" : "vscDeployed" }];
    case "safety_ending": return [{ ...base, type: "scEnding" }];
    case "safety_ended": return [{ ...base, type: "greenFlag" }];
    case "red_flag": return [{ ...base, type: "redFlag" }];
    case "restart": return [{ ...base, type: "restart" }];
    case "retirement": return [{ ...base, type: "retire", car: str(p.car) }];
    case "contact": return [{ ...base, type: "contact", car: str((p.cars as unknown[] | undefined)?.[0]), other: str((p.cars as unknown[] | undefined)?.[1]) }];
    case "local_yellow": return [{ ...base, type: "yellow", car: str(p.car) }];
    case "finish": return [{ ...base, type: "finish", car: str(p.car) }];
    case "classification": return [{ ...base, type: "win", car: winner ?? str((p.order as unknown[] | undefined)?.[0]) }];
    case "radio": return [{ ...base, type: "radio", car: str(p.car) }];
    default: return [];
  }
}

function lightingOf(session: Session, t: number, yellowUntilT: number): Lighting {
  if (session === "RED") return "red";
  if (session === "SC") return "sc";
  if (session === "VSC") return "vsc";
  if (session === "FINISHED") return "chequered";
  return t < yellowUntilT ? "yellow" : "green";
}

/** Pairs where a car is within `BLUE_WINDOW` of a lap behind a slower car's position, so it is about to lap it, with the slower car on the
 * main straight. Only under green: no one is lapped behind the safety car, and in the pits nobody is flagged. Needs only public timing. */
export function blueFlags(view: ContractView): BlueFlag[] {
  if (view.session !== "RACING") return [];
  const run = view.cars.filter((c) => c.status === "RUNNING");
  const out: BlueFlag[] = [];
  for (const slow of run) {
    if (!(slow.lap_frac >= STRAIGHT.from || slow.lap_frac <= STRAIGHT.to)) continue;
    const d = slow.lap + slow.lap_frac;
    for (const fast of run) {
      if (fast === slow || fast.lap < 2) continue; // nobody is lapped in the first laps
      const gap = fast.lap + fast.lap_frac - d; // distance the fast car is ahead in total
      const k = Math.round(gap);
      if (k >= 1 && gap < k + 0.005 && gap > k - BLUE_WINDOW) out.push({ lapped: slow.id, by: fast.id });
    }
  }
  return out;
}

/** The safety car's place and speed (lap fractions per sim second, from the last two states), or null while it is not on the track. */
function safetyCarOf(view: ContractView, prev: RenderModel | null, dtS: number): RenderModel["safetyCar"] {
  const sc = view.safety_car;
  if (!sc || typeof sc.lap_frac !== "number") return null;
  let speed = 0;
  if (prev?.safetyCar && dtS > 0) {
    let d = sc.lap_frac - prev.safetyCar.lapFrac;
    if (d < -0.5) d += 1;
    if (d >= 0 && d <= MAX_STEP) speed = d / dtS;
  }
  return { lapFrac: sc.lap_frac, speed };
}

const EMA = 0.4;

function carOf(c: ContractCar, prev: RenderCar | undefined, dtS: number, r: Resolver): RenderCar {
  const team = r.team(c.team);
  const num = r.driver(c.id).number;
  let speed = 0;
  if (prev && dtS > 0 && c.status !== "RETIRED" && c.status !== "FINISHED") {
    let d = c.lap_frac - prev.lapFrac;
    if (d < -0.5) d += 1; // crossed the line
    if (d >= 0 && d <= MAX_STEP) speed = prev.speed > 0 ? prev.speed + EMA * (d / dtS - prev.speed) : d / dtS;
  }
  return {
    id: c.id,
    teamId: c.team,
    num,
    lapFrac: Math.min(Math.max(c.lap_frac, 0), 0.999999),
    speed,
    status: c.status,
    compound: c.compound,
    position: c.position,
    livery: { primary: team.colours.primary, secondary: team.colours.secondary, accent: team.colours.accent, pattern: team.livery.pattern, number: num, image: r.teamImageUrl(c.team) },
  };
}

export function toRenderModel(prev: RenderModel | null, input: RenderInput, resolver: Resolver): RenderModel {
  const { view, clock, info, events } = input;
  const dtS = prev ? view.time_s - prev.t : 0;
  const before = new Map(prev?.cars.map((c) => [c.id, c]));
  const cars = view.cars.map((c) => carOf(c, before.get(c.id), dtS, resolver)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let yellowUntilT = prev && prev.yellowUntilT > view.time_s ? prev.yellowUntilT : 0;
  const cues: Cue[] = [];
  const seen = new Map<string, number>();
  for (const e of events) {
    if (e.type === "local_yellow") yellowUntilT = view.time_s + YELLOW_HOLD_S;
    for (const c of cuesFor(e)) {
      const key = `${c.tick}:${c.type}:${c.car ?? ""}:${c.other ?? ""}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      cues.push({ ...c, id: n ? `${key}:${n}` : key });
    }
  }

  const sinceBefore = new Map(prev?.pitLane.map((p) => [p.car, p.sinceT]));
  const pitLane = cars.filter((c) => c.status === "IN_PIT").map((c) => ({ car: c.id, teamId: c.teamId, sinceT: sinceBefore.get(c.id) ?? view.time_s }));

  return {
    contract: RENDER_CONTRACT,
    t: view.time_s,
    tick: clock.tick,
    stateIntervalS: dtS > 0 ? dtS : prev?.stateIntervalS ?? 0.5,
    session: view.session,
    lighting: lightingOf(view.session, view.time_s, yellowUntilT),
    yellowUntilT,
    lap: view.race_lap,
    totalLaps: view.total_laps,
    circuit: info.circuit,
    safetyEnding: (view.session === "SC" || view.session === "VSC") && (events.some((e) => e.type === "safety_ending") || (prev?.safetyEnding === true && prev.session === view.session)),
    blue: blueFlags(view),
    safetyCar: safetyCarOf(view, prev, dtS),
    weather: { raining: view.weather?.raining === true, track: view.weather?.track === "damp" || view.weather?.track === "wet" ? view.weather.track : "dry" },
    corners: (info.corners ?? []).map((c) => ({ n: c.n, frac: c.frac })),
    cars,
    pitLane,
    cues,
    mine: [...info.human_cars].sort(),
  };
}

/** Where a car is drawn `elapsedSimS` sim seconds after the model's state arrived: the state plus movement at the observed speed,
 * for at most 1.5 state intervals, and not at all when paused or when the car has no speed. Wraps at the line. */
export function interpolate(model: RenderModel, car: RenderCar, elapsedSimS: number, paused: boolean): number {
  if (paused || car.speed <= 0 || elapsedSimS <= 0) return car.lapFrac;
  const run = Math.min(elapsedSimS, Math.max(model.stateIntervalS, 0.1) * 1.5);
  return (car.lapFrac + car.speed * run) % 1;
}
