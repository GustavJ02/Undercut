/** The signals of the scene as pure functions of the race state and time: the gantry lights, marshal flags, ambient tint and rain.
 * `now` is wall seconds; the caller passes when the last green-flag and lights-out cues arrived. */
import type { Lighting } from "../../render/model";

export type LampColour = "off" | "red" | "amber" | "green";

export interface Gantry {
  colour: LampColour;
  lit: [boolean, boolean, boolean, boolean, boolean];
}

const all = (on: boolean): Gantry["lit"] => [on, on, on, on, on];
export const GREEN_SHOW_S = 4;
export const GO_FLASH_S = 0.7;

/** The five start lights: dark on the grid until the start sequence lights them one by one (`startLit`), red under a red flag, amber and flashing under the safety car, green for a few seconds after
 * the restart, a quick flash of nothing at lights out, otherwise dark. */
export function gantryState(o: { session: string; lighting: Lighting; now: number; greenAt: number | null; lightsOutAt: number | null; startLit?: number | null }): Gantry {
  const { session, lighting, now, greenAt, lightsOutAt, startLit } = o;
  if (session === "GRID") return { colour: "red", lit: [0, 1, 2, 3, 4].map((i) => i < (startLit ?? 0)) as Gantry["lit"] };
  if (lighting === "red") return { colour: "red", lit: all(true) };
  if (lighting === "sc" || lighting === "vsc") return { colour: "amber", lit: all(Math.floor(now * 1.5) % 2 === 0) };
  if (greenAt !== null && now - greenAt < GREEN_SHOW_S) return { colour: "green", lit: all(true) };
  if (lightsOutAt !== null && now - lightsOutAt < GO_FLASH_S) return { colour: "green", lit: all(Math.floor((now - lightsOutAt) * 12) % 2 === 0) };
  return { colour: "off", lit: all(false) };
}

export type FlagColour = "none" | "yellow" | "red" | "chequered";

/** The flags at the marshal posts. A local yellow, the safety car and the VSC all show yellow. */
export const flagFor = (l: Lighting): FlagColour => (l === "yellow" || l === "sc" || l === "vsc" ? "yellow" : l === "red" ? "red" : l === "chequered" ? "chequered" : "none");

/** A flag's waving as a vertical offset of its trailing corner, in pixels. */
export const wave = (i: number, now: number, amp = 4): number => amp * Math.sin(now * 5 + i * 0.9);

/** Ambient colour over the scene. */
export function tintFor(l: Lighting, raining: boolean): { colour: number; alpha: number } {
  if (l === "red") return { colour: 0xe8334a, alpha: 0.16 };
  if (l === "sc" || l === "vsc") return { colour: 0xf2c230, alpha: 0.07 };
  if (l === "yellow") return { colour: 0xf2c230, alpha: 0.05 };
  if (raining) return { colour: 0x1d2d4a, alpha: 0.22 };
  return { colour: 0x000000, alpha: 0 };
}

export const trackSheen = (track: "dry" | "damp" | "wet"): number => (track === "wet" ? 0.5 : track === "damp" ? 0.22 : 0);

export interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed set of raindrops over a width and height; deterministic, so a screenshot is repeatable. */
export function makeDrops(n: number, w: number, h: number, seed = 5): Drop[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, len: 10 + r() * 16, speed: 700 + r() * 500 }));
}

/** Where a drop is `t` seconds after it started, wrapping at the bottom. */
export const dropY = (d: Drop, t: number, h: number): number => (d.y + d.speed * t) % h;

export interface Board {
  /** One or two lines of the LED text. */
  lines: [string] | [string, string];
  colour: number;
  /** Whether the LEDs are lit at this moment: the boards flash. */
  lit: boolean;
}

export const BOARD_COLOUR = { amber: 0xffb020, blue: 0x2f7bff } as const;
/** How long a blue flag stays up once shown, so a pass-by of a second or two is still readable, in wall seconds. */
export const BLUE_HOLD_S = 3;

/** What the LED boards show: the blue flag first (only under green), then the safety car or VSC, and its announced end. `blueNum` is
 * the number of the car being lapped. Flashes at 1.5 Hz, faster once the end is announced; steady with reduced motion. */
export function boardState(o: { lighting: Lighting; safetyEnding: boolean; blueNum: number | null; now: number; reduced: boolean }): Board | null {
  const { lighting, safetyEnding, blueNum, now, reduced } = o;
  const flash = (hz: number) => reduced || Math.floor(now * hz * 2) % 2 === 0;
  if (blueNum !== null && (lighting === "green" || lighting === "yellow")) return { lines: ["BLUE", `#${blueNum}`], colour: BOARD_COLOUR.blue, lit: flash(2.5) };
  if (lighting === "sc") return safetyEnding ? { lines: ["SC", "IN THIS LAP"], colour: BOARD_COLOUR.amber, lit: flash(3) } : { lines: ["SC"], colour: BOARD_COLOUR.amber, lit: flash(1.5) };
  if (lighting === "vsc") return safetyEnding ? { lines: ["VSC", "ENDING"], colour: BOARD_COLOUR.amber, lit: flash(3) } : { lines: ["VSC"], colour: BOARD_COLOUR.amber, lit: flash(1.5) };
  return null;
}
