/** The director decides what each person does, from the render model's cues (design section 3: event-triggered animation). Pure and
 * clocked by the caller in wall milliseconds, so it is tested with scripted cues. Clips run in wall time, not simulated time: a
 * wheel gun that ran at 10x would only blur. The stop itself starts when the scene sees the car stop in its box (`onStop`), a place worked out from
 * the time since pit_in until the backend names the phase of a pit stop (request R2). */
import type { Cue } from "../../render/model";
import { CLIP_SECONDS, finished, type ClipName } from "./poses";
import type { Facing, Prop, Role } from "./spec";

export interface Slot {
  id: string;
  group: "crew" | "engineer" | "strategist" | "driver";
  role: Role;
  x: number; // design-space x of the feet
  y: number; // design-space y of the feet
  facing: Facing;
  prop: Prop;
  job?: "wheel" | "jack" | "lollipop" | "spare";
  base: ClipName; // what the person does when nothing is happening
}

const lane = 388; // feet on the pit lane
const wall = 413; // feet behind the pit wall, hidden by it from the knees down

export const ROSTER: Slot[] = [
  { id: "crew-wheel-fl", group: "crew", role: "crew", x: 1240, y: lane, facing: "away", prop: "gun", job: "wheel", base: "idle" },
  { id: "crew-wheel-fr", group: "crew", role: "crew", x: 1282, y: lane, facing: "away", prop: "gun", job: "wheel", base: "idle" },
  { id: "crew-jack-f", group: "crew", role: "crew", x: 1326, y: lane, facing: "away", prop: "jack", job: "jack", base: "idle" },
  { id: "crew-spare", group: "crew", role: "crew", x: 1368, y: lane, facing: "away", prop: "none", job: "spare", base: "idle" },
  { id: "crew-wheel-rl", group: "crew", role: "crew", x: 1410, y: lane, facing: "away", prop: "gun", job: "wheel", base: "idle" },
  { id: "crew-wheel-rr", group: "crew", role: "crew", x: 1452, y: lane, facing: "away", prop: "gun", job: "wheel", base: "idle" },
  { id: "crew-jack-r", group: "crew", role: "crew", x: 1494, y: lane, facing: "away", prop: "jack", job: "jack", base: "idle" },
  { id: "crew-lollipop", group: "crew", role: "crew", x: 1560, y: lane, facing: "away", prop: "lollipop", job: "lollipop", base: "idle" },
  { id: "eng-1", group: "engineer", role: "engineer", x: 310, y: wall, facing: "away", prop: "tablet", base: "tablet" },
  { id: "eng-2", group: "engineer", role: "engineer", x: 372, y: wall, facing: "away", prop: "none", base: "idle" },
  { id: "strategist", group: "strategist", role: "strategist", x: 450, y: wall, facing: "away", prop: "none", base: "idle" },
  { id: "driver-0", group: "driver", role: "driver", x: 610, y: wall, facing: "toward", prop: "helmet", base: "idle" },
  { id: "driver-1", group: "driver", role: "driver", x: 672, y: wall, facing: "toward", prop: "helmet", base: "idle" },
];

interface Assign {
  clip: ClipName;
  start: number; // ms
  until?: number; // ms, for clips that hold
}

interface Due {
  at: number;
  slots: string[];
  clip: ClipName;
  until?: number;
}

const HOLD_READY_MS = 25000;
const CHEER_MS = 10000;
const ALERT_MS = 6000;

export class Director {
  private assign = new Map<string, Assign>();
  private due: Due[] = [];
  private shown = new Set<string>(); // driver slots that are on show
  private mineIds: string[];

  constructor(mine: string[]) {
    this.mineIds = [...mine].sort();
    for (const s of ROSTER) this.assign.set(s.id, { clip: s.base, start: 0 });
  }

  private slots(group: Slot["group"], job?: Slot["job"]) {
    return ROSTER.filter((s) => s.group === group && (!job || s.job === job)).map((s) => s.id);
  }

  private set(ids: string[], clip: ClipName, now: number, until?: number) {
    for (const id of ids) this.assign.set(id, { clip, start: now, until });
  }

  private schedule(at: number, ids: string[], clip: ClipName, until?: number) {
    this.due.push({ at, slots: ids, clip, until });
  }

  /** Which driver slot belongs to a car: the order of the player's own cars. */
  driverSlot(car: string): string | undefined {
    const i = this.mineIds.indexOf(car);
    return i >= 0 && i < 2 ? `driver-${i}` : undefined;
  }

  visible(id: string): boolean {
    const s = ROSTER.find((x) => x.id === id);
    return !!s && (s.group !== "driver" || this.shown.has(id));
  }

  onCue(cue: Cue, now: number, winnerIsMine = false): void {
    const mine = cue.car !== undefined && this.mineIds.includes(cue.car);
    const crew = this.slots("crew");
    switch (cue.type) {
      case "pitCall":
        if (!mine) return;
        this.set(crew, "ready", now, now + HOLD_READY_MS);
        this.set(this.slots("crew", "lollipop"), "lollipopRed", now, now + HOLD_READY_MS);
        this.set(this.slots("engineer").slice(1), "radio", now, now + 3000);
        return;
      case "pitIn": // the car is in the lane: get ready, and hold the board; the work starts when it stops (`onStop`)
        if (!mine) return;
        this.due = this.due.filter((d) => !d.slots.some((s) => crew.includes(s)));
        this.set(crew, "ready", now, now + HOLD_READY_MS);
        this.set(this.slots("crew", "lollipop"), "lollipopRed", now, now + HOLD_READY_MS);
        return;
      case "pitOut":
        if (!mine) return;
        this.due = this.due.filter((d) => !d.slots.some((s) => crew.includes(s)));
        for (const s of ROSTER.filter((r) => r.group === "crew")) this.set([s.id], s.base, now);
        return;
      case "scDeployed":
      case "vscDeployed":
        this.set(this.slots("engineer").slice(0, 1), "radio", now, now + ALERT_MS);
        this.set(this.slots("engineer").slice(1), "point", now);
        this.set(this.slots("strategist"), "radio", now, now + ALERT_MS);
        return;
      case "redFlag":
        this.set(crew, "crossed", now, now + 60000);
        return;
      case "greenFlag":
      case "restart":
        for (const s of ROSTER.filter((r) => r.group === "crew" && this.assign.get(r.id)?.clip === "crossed")) this.set([s.id], s.base, now);
        return;
      case "retire":
        if (!mine) return;
        {
          const d = this.driverSlot(cue.car!);
          if (d) {
            this.shown.add(d);
            this.set([d], "gloom", now);
          }
        }
        return;
      case "win":
        if (!(winnerIsMine || mine)) return;
        for (const s of ROSTER) if (s.group !== "driver") this.set([s.id], "cheer", now, now + CHEER_MS);
        for (const id of this.mineIds) {
          const d = this.driverSlot(id);
          if (d && !this.shown.has(d)) {
            this.shown.add(d);
            this.set([d], "cheer", now, now + CHEER_MS);
          }
        }
        return;
    }
  }

  /** The player's car has stopped in its box: jacks up, guns on, then the green board. Called by the scene when the car's place in the
   * lane says it has stopped (the backend does not name the phase yet, request R2). */
  onStop(now: number): void {
    this.due = this.due.filter((d) => !d.slots.some((s) => this.slots("crew").includes(s)));
    this.schedule(now + 200, this.slots("crew", "jack"), "jack");
    this.schedule(now + 400, this.slots("crew", "wheel"), "gun");
    this.schedule(now + 2400, this.slots("crew", "lollipop"), "lollipopGreen");
  }

  /** Run due items and let finished clips fall back to what the person normally does. */
  update(now: number): void {
    if (this.due.length) {
      const ready = this.due.filter((d) => d.at <= now);
      this.due = this.due.filter((d) => d.at > now);
      for (const d of ready) this.set(d.slots, d.clip, d.at, d.until);
    }
    for (const s of ROSTER) {
      const a = this.assign.get(s.id)!;
      const t = (now - a.start) / 1000;
      const expired = a.until !== undefined ? now >= a.until : finished(a.clip, t);
      if (expired && a.clip !== s.base) this.assign.set(s.id, { clip: s.base, start: now });
    }
  }

  /** The clip a person is in and its seconds since it started. */
  clip(id: string, now: number): { clip: ClipName; t: number } {
    const a = this.assign.get(id)!;
    return { clip: a.clip, t: Math.max(0, (now - a.start) / 1000) };
  }
}

export { CLIP_SECONDS };
