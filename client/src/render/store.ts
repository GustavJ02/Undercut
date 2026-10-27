/** Turns the stream of server messages into render models and keeps the newest one, outside React: the scene polls it every
 * frame, so a state arriving ten times a second never causes a React render. Events that arrive before their state are held and
 * go into that state's model. Cues are kept in a log read by cursor, so the scene and, later, the audio each see every cue once. */
import { toRenderModel, interpolate, type Cue, type RenderCar, type RenderInput, type RenderModel } from "./model";
import type { ContractClock, ContractEvent, ContractInfo, ContractView } from "../contract/types";
import type { Resolver } from "../packs/resolve";

const CUE_LOG = 400;

export type Incoming =
  | { type: "snapshot"; info: ContractInfo; view: ContractView; clock: ContractClock; history: ContractEvent[] }
  | { type: "state"; view: ContractView }
  | { type: "event"; event: ContractEvent }
  | ({ type: "clock" } & ContractClock);

export class ModelStore {
  model: RenderModel | null = null;
  arrivedAt = 0; // wall ms when `model` was built
  speed = 1;
  paused = false;
  /** Bumped when the resolver changes, so anything built from identities (the people) knows to rebuild. */
  version = 0;
  private info: ContractInfo | null = null;
  private clock: ContractClock | null = null;
  private view: ContractView | null = null;
  private pending: ContractEvent[] = [];
  private cueLog: Cue[] = [];
  private cueBase = 0; // cursor of cueLog[0]

  constructor(public resolver: Resolver) {}

  /** Replace the pack (a mod was chosen or reloaded): the same state is rebuilt with the new identities. */
  setResolver(r: Resolver, now: number): void {
    this.resolver = r;
    this.version++;
    if (this.view && this.info && this.clock) this.build(this.view, [], now, null);
  }

  push(msg: Incoming, now: number): void {
    switch (msg.type) {
      case "snapshot":
        this.info = msg.info;
        this.clock = msg.clock;
        this.pending = []; // history is the past: it must not replay as cues
        this.model = null;
        this.build(msg.view, [], now, null);
        break;
      case "state": {
        const events = this.pending;
        this.pending = [];
        this.build(msg.view, events, now, this.model);
        break;
      }
      case "event":
        this.pending.push(msg.event);
        break;
      case "clock": {
        const { type: _t, ...clock } = msg;
        this.clock = clock;
        this.speed = clock.speed;
        this.paused = clock.paused;
        break;
      }
    }
  }

  private build(view: ContractView, events: ContractEvent[], now: number, prev: RenderModel | null): void {
    if (!this.info || !this.clock) return;
    this.view = view;
    this.speed = this.clock.speed;
    this.paused = this.clock.paused;
    const input: RenderInput = { view, clock: this.clock, info: this.info, events };
    this.model = toRenderModel(prev, input, this.resolver);
    this.arrivedAt = now;
    this.cueLog.push(...this.model.cues);
    if (this.cueLog.length > CUE_LOG) {
      const drop = this.cueLog.length - CUE_LOG;
      this.cueLog.splice(0, drop);
      this.cueBase += drop;
    }
  }

  /** The cursor after the last cue so far: start reading from here to skip everything already shown. */
  get cueEnd(): number {
    return this.cueBase + this.cueLog.length;
  }

  /** Cues logged at or after `cursor`, and the cursor to pass next time. */
  cuesSince(cursor: number): { cues: Cue[]; next: number } {
    const from = Math.max(cursor, this.cueBase);
    return { cues: this.cueLog.slice(from - this.cueBase), next: this.cueBase + this.cueLog.length };
  }

  /** Sim seconds at wall time `now`: the newest state's time plus the movement allowed in between (the same rule as `interpolate`). */
  simNow(now: number): number {
    const m = this.model;
    if (!m) return 0;
    if (this.paused) return m.t;
    return m.t + Math.min(((now - this.arrivedAt) / 1000) * this.speed, Math.max(m.stateIntervalS, 0.1) * 1.5);
  }

  /** Where to draw the safety car at wall time `now`, or null when it is not on the track. */
  safetyCarFrac(now: number): number | null {
    const sc = this.model?.safetyCar;
    if (!sc || !this.model) return null;
    return interpolate(this.model, { lapFrac: sc.lapFrac, speed: sc.speed } as RenderCar, ((now - this.arrivedAt) / 1000) * this.speed, this.paused);
  }

  /** The lap fraction to draw `car` at wall time `now`. */
  lapFrac(car: RenderCar, now: number): number {
    if (!this.model) return car.lapFrac;
    return interpolate(this.model, car, ((now - this.arrivedAt) / 1000) * this.speed, this.paused);
  }
}
