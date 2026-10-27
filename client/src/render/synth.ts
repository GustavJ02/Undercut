/** A small synthetic race that speaks the server's message format, for tests, the replay harness and performance runs where a
 * recorded race is too sparse (fixtures are sampled every 20 s) and the live server is not wanted. Cars run at slightly
 * different speeds, stop in the pits, retire, and follow a safety car period. It is deterministic from its seed, uses ids only
 * (no names) and is checked against the contract by a test, so it cannot drift from what the server sends. */
import type { ContractCar, ContractEvent, ContractView } from "../contract/types";
import type { Incoming } from "./store";

export interface SynthOptions {
  seed: number;
  carIds: { id: string; team: string }[];
  laps: number;
  lapS?: number;
  dt?: number;
  human?: string[];
  safetyCar?: [number, number]; // start and end sim seconds
  retire?: Record<string, number>; // car id -> sim second it stops
  pitLaps?: number[]; // every car stops on the lap after each of these
  rain?: [number, number]; // start and end sim seconds of rain
  redFlag?: [number, number]; // start and end sim seconds of a red flag
  slow?: string; // a car that is much slower than the rest, so the leaders lap it
  leader?: string; // a car that is much faster than the rest, so it wins
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIT_S = 22;
const PIT_ENTRY = 0.95; // lap fraction where the pit lane starts

interface Sim { id: string; team: string; pace: number; progress: number; status: ContractCar["status"]; stops: number; pitUntil: number; lapDone: number; finishT: number | null; pitShift: number; called: boolean }

export function* synth(o: SynthOptions): Generator<Incoming> {
  const lapS = o.lapS ?? 90, dt = o.dt ?? 0.5, r = rng(o.seed);
  const pitLaps = o.pitLaps ?? [Math.max(1, Math.floor(o.laps / 2))];
  const cars: Sim[] = o.carIds.map((c, i) => ({ ...c, pace: 1 + (r() - 0.5) * 0.06 - i * 0.0006, progress: -(i + 1) * 0.012, status: "RUNNING", stops: 0, pitUntil: 0, lapDone: 0, finishT: null, pitShift: o.human?.includes(c.id) ? 0 : i % 4, called: false }));
  if (o.slow) cars.find((c) => c.id === o.slow)!.pace = 0.7;
  if (o.leader) cars.find((c) => c.id === o.leader)!.pace = 1.12;
  const corners = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, frac: Math.round(((i + 0.5) / 18) * 1e4) / 1e4 }));
  const info = { id: "synth", engine_version: "0", corners, circuit: "austin", total_laps: o.laps, pit_loss_s: 21.4, traffic_window_s: 1.2, fuel_s_per_lap: 0.05, human_team: o.human?.length ? o.carIds.find((c) => c.id === o.human![0])!.team : null, human_cars: o.human ?? [] };
  let warned = false, tick = 0, session: ContractView["session"] = "RACING", classified = false;

  const view = (): ContractView => {
    const order = [...cars].sort((a, b) => (a.status === "RETIRED" ? -1 : 0) - (b.status === "RETIRED" ? -1 : 0) || b.progress - a.progress);
    const lead = order[0];
    const rows = order.map((c, i) => {
      const ahead = order[i - 1];
      return {
        id: c.id, team: c.team, position: i + 1, lap: Math.max(Math.floor(c.progress), 0), status: c.status,
        lap_frac: Math.round((((c.progress % 1) + 1) % 1) * 1e4) / 1e4, compound: c.stops ? "HARD" : "MEDIUM", tyre_age: c.lapDone, stops: c.stops,
        // the fields the renderer must ignore are sent too, as the server does
        driver: `Driver ${c.id}`, compounds_used: c.stops ? ["MEDIUM", "HARD"] : ["MEDIUM"], sets_remaining: { SOFT: 2, MEDIUM: 1, HARD: 1 },
        last_lap_s: c.lapDone ? lapS / c.pace : null, laps_down: Math.max(Math.floor(lead.progress) - Math.floor(c.progress), 0),
        gap_to_leader_s: c === lead ? 0 : Math.round((lead.progress - c.progress) * lapS * 1e3) / 1e3,
        interval_s: ahead ? Math.round((ahead.progress - c.progress) * lapS * 1e3) / 1e3 : null,
      };
    });
    return {
      time_s: tick * dt, session, track_status: session === "SC" ? "SCDeployed" : session === "VSC" ? "VSCDeployed" : session === "RED" ? "Red" : "AllClear",
      race_lap: Math.min(Math.floor(lead.progress) + 1, o.laps), total_laps: o.laps, cars: rows,
      weather: { raining: !!o.rain && tick * dt >= o.rain[0] && tick * dt < o.rain[1], track: !o.rain || tick * dt < o.rain[0] ? "dry" : tick * dt < o.rain[1] ? "wet" : tick * dt < o.rain[1] + 90 ? "damp" : "dry", wet_race_declared: false, forecast_pre_race_pct: 10, forecast_next_laps: [0.02, 0.05, 0.01, 0, 0, 0.03, 0.04, 0.02, 0.1, 0.12] },
      safety_car: session === "SC" ? { lap_frac: Math.round((((lead.progress + 0.004) % 1) + 1) % 1 * 1e4) / 1e4 } : null,
      own: Object.fromEntries((o.human ?? []).map((id) => [id, { est_tyre_loss_s: 0.123, box_call: null }])),
    } as unknown as ContractView;
  };
  const clock = () => ({ time_s: tick * dt, tick, speed: 1, paused: false, pause_allowed: true, session });
  yield { type: "snapshot", info: info as never, view: view(), clock: clock(), history: [], laps: Object.fromEntries(cars.map((c) => [c.id, []])) } as Incoming;

  while (cars.some((c) => c.status === "RUNNING" || c.status === "IN_PIT")) {
    tick++;
    const t = tick * dt, events: ContractEvent[] = [];
    const ev = (type: string, payload: Record<string, unknown>) => events.push({ tick, type, payload });
    if (o.redFlag && t >= o.redFlag[0] && session === "RACING") { session = "RED"; ev("red_flag", { lap: 1 }); }
    if (o.redFlag && t >= o.redFlag[1] && session === "RED") { session = "RACING"; ev("restart", { order: [], lap: 1 }); }
    if (o.safetyCar && t >= o.safetyCar[0] && session === "RACING") { session = "SC"; ev("safety_deployed", { kind: "SC" }); }
    if (o.safetyCar && t >= o.safetyCar[1] - lapS * 0.5 && session === "SC" && !warned) { warned = true; ev("safety_ending", { kind: "SC" }); }
    if (o.safetyCar && t >= o.safetyCar[1] && session === "SC") { session = "RACING"; ev("safety_ended", { kind: "SC" }); }
    for (const c of cars) {
      if (c.status === "RETIRED" || c.status === "FINISHED") continue;
      if (o.retire?.[c.id] !== undefined && t >= o.retire[c.id]) { c.status = "RETIRED"; ev("retirement", { car: c.id, lap: Math.floor(c.progress) }); continue; }
      const f = ((c.progress % 1) + 1) % 1;
      const inLane = c.status === "IN_PIT";
      const speed = (session === "RED" ? 0 : session === "SC" ? 0.45 : 1) * c.pace * (inLane ? 0.35 : 1) / lapS;
      const before = Math.floor(c.progress);
      c.progress += speed * dt;
      if (Math.floor(c.progress) > before) {
        c.lapDone++;
        const lap = Math.floor(c.progress);
        const flags = (c.status === "IN_PIT" ? "P" : "") + (session === "SC" ? "S" : session === "RED" ? "R" : "");
        const time = (lapS / c.pace) * (1 + 0.004 * c.lapDone) - 0.05 * lap + (r() - 0.5) * 0.5 + (flags.includes("P") ? 18 : 0) + (flags.includes("S") ? 25 : 0);
        ev("lap", { car: c.id, lap, lap_time: Math.round(time * 1e3) / 1e3, compound: c.stops ? "HARD" : "MEDIUM", age: c.lapDone, flags });
      }
      if (o.human?.includes(c.id) && !c.called && c.stops < pitLaps.length && Math.floor(c.progress) === pitLaps[c.stops] + c.pitShift && c.progress % 1 >= 0.55) {
        c.called = true;
        ev("box_ack", { car: c.id, ok: true, message: "Box confirmed, hard", effective_lap: Math.floor(c.progress) + 1 });
      }
      if (!inLane && c.stops < pitLaps.length && Math.floor(c.progress) === pitLaps[c.stops] + c.pitShift && f < PIT_ENTRY && ((c.progress % 1) >= PIT_ENTRY)) {
        c.status = "IN_PIT"; c.pitUntil = t + PIT_S; ev("pit_in", { car: c.id, stop: c.stops + 1, compound: "HARD" });
      } else if (inLane && t >= c.pitUntil) {
        c.status = "RUNNING"; c.stops++; c.lapDone = 0; c.called = false; ev("pit_out", { car: c.id, compound: "HARD", stop: c.stops });
      }
      if (c.progress >= o.laps) { c.status = "FINISHED"; c.finishT = t; ev("finish", { car: c.id, laps: o.laps, time: t }); }
    }
    if (!classified && cars.every((c) => c.status === "FINISHED" || c.status === "RETIRED")) {
      classified = true; session = "FINISHED";
      ev("classification", { order: [...cars].sort((a, b) => (a.finishT ?? 1e9) - (b.finishT ?? 1e9)).map((c) => c.id) });
    }
    for (const e of events) yield { type: "event", event: e };
    yield { type: "state", view: view() };
    yield { type: "clock", ...clock() };
  }
}

export const allSynth = (o: SynthOptions): Incoming[] => [...synth(o)];
