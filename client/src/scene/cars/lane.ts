/** Where cars are on the pit-wall stage: pure maps from the render model to design-space x, so they are tested as numbers.
 *
 * Track: the main straight runs left to right in front of the camera with the start/finish line at `LINE_X`; a car is drawn while it
 * is within about two seconds of the line, so cars sweep across the screen as they pass the pit wall.
 * Pit lane: a car in the lane (status IN_PIT) enters at the left, rolls to its garage box, stops for the tyre change and leaves at
 * the right; its place comes from the sim seconds since it was first seen in the lane (the backend does not yet name the phase, R2). */
export const LINE_X = 1500;
export const PX_PER_LAP = 90000; // a lap fraction of 0.001 is 90 px: at a 90 s lap a car crosses the 1920 px screen in about 2 s
export const OFF_LEFT = -320;
export const OFF_RIGHT = 3700; // the track goes on to the right, where the strategy screen is
export const LANE_EXIT = 2240;

/** The scale on the grid: 22 cars 0.4 s apart span about 0.12 of a lap, so the whole grid fits on screen only at this scale. */
export const GRID_PX_PER_LAP = 12500;
/** Cars are drawn this much smaller on the grid, so a row of cars 0.4 s apart does not hide itself behind the pole car. */
export const GRID_CAR_SCALE = 0.4;
/** Sim seconds after lights out over which the scale opens up from the grid's to the racing one, so the field is seen pulling away. */
export const LAUNCH_RAMP_S = 11;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Pixels per lap: the grid's before the start and in the first seconds, then the racing scale. `sinceLaunch` is null in mid-race. */
export function pxPerLap(session: string, sinceLaunch: number | null): number {
  if (session === "GRID") return GRID_PX_PER_LAP;
  if (sinceLaunch === null || sinceLaunch >= LAUNCH_RAMP_S) return PX_PER_LAP;
  return GRID_PX_PER_LAP + (PX_PER_LAP - GRID_PX_PER_LAP) * smooth(Math.max(sinceLaunch, 0) / LAUNCH_RAMP_S);
}

/** 1 on the grid, falling to 0 as the scale opens up: how much of the staggered two-by-two grid is still shown. */
export const gridness = (px: number): number => (PX_PER_LAP - px) / (PX_PER_LAP - GRID_PX_PER_LAP);

export const carScale = (grid: number): number => 1 - Math.min(Math.max(grid, 0), 1) * (1 - GRID_CAR_SCALE);

/** Signed distance to the line in laps, in [-0.5, 0.5). */
export const signedLap = (lapFrac: number): number => ((((lapFrac + 0.5) % 1) + 1) % 1) - 0.5;

/** x of a car on the track in the real scale, even when it is off screen. */
export const rawX = (lapFrac: number): number => LINE_X + signedLap(lapFrac) * PX_PER_LAP;

/** A car that started from the grid is drawn from its slot at the grid's scale, plus the way it has travelled since at the scale of the
 * moment. The scale only ever grows, so the car's x never goes down: opening the scale up does not push the field backwards. `frac0` is the
 * lap fraction of its slot, `frac` where it is now. */
export function anchoredX(frac0: number, frac: number, px: number): number {
  let travelled = (((frac - frac0) % 1) + 1) % 1;
  if (travelled > 0.5) travelled = 0; // a hair behind the slot is not a lap
  return LINE_X + signedLap(frac0) * GRID_PX_PER_LAP + travelled * px;
}

/** x of a car on the track at lap fraction `lapFrac`, or null when it is off screen. */
export function trackX(lapFrac: number, px = PX_PER_LAP): number | null {
  const d = ((((lapFrac + 0.5) % 1) + 1) % 1) - 0.5; // signed distance to the line, in laps, in [-0.5, 0.5)
  const x = LINE_X + d * px;
  return x >= OFF_LEFT && x <= OFF_RIGHT ? x : null;
}

/** Sim seconds in the lane: rolling in, stopped, rolling out. The stop starts at `enter`. */
export const LANE = { enter: 8, stopped: 3.5, total: 19 } as const;

/** The sim second of a stop at which the new tyres are on: the guns have run and the green board is up (the crew's own timing at 1x). */
export const SWAP_AT = LANE.enter + 2.4;

export type LanePhase = "entering" | "stopped" | "leaving" | "gone";

export function lanePhase(e: number): LanePhase {
  if (e < LANE.enter) return "entering";
  if (e < LANE.enter + LANE.stopped) return "stopped";
  return e < LANE.total ? "leaving" : "gone";
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** x of a car `e` sim seconds after entering the lane, stopping at `box`. It decelerates into the box and accelerates out. */
export function laneX(e: number, box: number): number {
  if (e < LANE.enter) return OFF_LEFT + (box - OFF_LEFT) * (1 - Math.pow(1 - clamp01(e / LANE.enter), 2));
  if (e < LANE.enter + LANE.stopped) return box;
  const out = clamp01((e - LANE.enter - LANE.stopped) / (LANE.total - LANE.enter - LANE.stopped));
  return box + (LANE_EXIT - box) * Math.pow(ease(out), 1.6);
}

/** The player's garage box: the middle of their crew. Rivals get boxes spread along the lane, clear of the player's crew. */
export const OWN_BOX = 1400;
const SLOTS = [120, 330, 540, 750, 960, 1170, 1740, 1950];

export function boxX(teamId: string, ownTeam: string): number {
  if (teamId === ownTeam) return OWN_BOX;
  let h = 2166136261;
  for (let i = 0; i < teamId.length; i++) h = Math.imul(h ^ teamId.charCodeAt(i), 16777619);
  return SLOTS[(h >>> 0) % SLOTS.length];
}
