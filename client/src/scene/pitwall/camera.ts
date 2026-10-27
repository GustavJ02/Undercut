/** The camera of the pit-wall stage. A pose is a zoom and the design-space point that sits at the middle of the window; a
 * tween between two poses is a pure function of time, so it is tested without a browser. The same matrix drives the Pixi world and
 * the CSS transform of the DOM monitors, which is why the DOM never drifts from the art. At the end pose the scale is just the
 * fit-to-window factor (1 at 1920x1080), so monitor text is drawn at native pixels. */
import { DROP, STAGE } from "./layout";

export interface Pose {
  zoom: number;
  fx: number; // design-space point shown at the centre of the window
  fy: number;
}

export type PoseName = "landing" | "pitwall" | "strategy";

export const POSES: Record<PoseName, Pose> = {
  landing: { zoom: 1.2, fx: 960, fy: 190 },
  pitwall: { zoom: 1, fx: 960, fy: 540 },
  /** The screen to the right of the wall: the strategist looks over to it, away from the timing, the radio and the pit calls. */
  strategy: { zoom: 1, fx: 2760, fy: 540 },
};

export const LOOK_MS = 900;

/** 1 while the camera is anywhere on the desk, and eases with the move into or out of it from the landing shot: the monitors fade only then. */
export function deskness(source: PoseName, target: PoseName, progress: number): number {
  if (target === "landing") return 1 - progress;
  return source === "landing" ? progress : 1;
}

export const INTRO_MS = 3200;
export const RETURN_MS = 1200;

export interface Matrix {
  scale: number;
  tx: number; // window pixels
  ty: number;
}

/** Fit the 1920x1080 stage in the window, then apply the pose: the focus point lands at the window centre. */
export function matrixFor(pose: Pose, vw: number, vh: number): Matrix {
  const fit = Math.min(vw / STAGE.w, vh / STAGE.h);
  const scale = fit * pose.zoom;
  return { scale, tx: vw / 2 - pose.fx * scale, ty: vh / 2 - pose.fy * scale };
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Zoom is interpolated in log space so a push-in feels even; the focus point moves linearly. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return { zoom: Math.exp(mix(Math.log(a.zoom), Math.log(b.zoom), t)), fx: mix(a.fx, b.fx, t), fy: mix(a.fy, b.fy, t) };
}

export interface Tween {
  from: Pose;
  to: Pose;
  start: number; // ms, any clock
  duration: number;
}

/** Progress 0..1 of a tween at `now`, eased. A zero duration is already there. */
export function progressAt(tw: Tween, now: number): number {
  if (tw.duration <= 0) return 1;
  return easeInOutCubic(Math.min(Math.max((now - tw.start) / tw.duration, 0), 1));
}

export const poseAt = (tw: Tween, now: number): Pose => lerpPose(tw.from, tw.to, progressAt(tw, now));

/** Whether to play the move into the pit wall, and how long it takes. The camera moves when the grid is first shown, before the clock
 * runs, so the start is never hidden by it; a race already under way, one this browser has seen the intro of, reduced motion and a
 * skipped intro all go straight to the end pose. */
export function planMove(o: { reducedMotion: boolean; skipIntro: boolean; seenRoom: boolean; session: string }): { animate: boolean; ms: number } {
  const animate = !o.reducedMotion && !o.skipIntro && !o.seenRoom && o.session === "GRID";
  return { animate, ms: animate ? INTRO_MS : 0 };
}


/** The pose with the camera dropped: `drop` 0 is the wall as drawn, 1 shows only a thin band of the scenery above taller monitors. */
export const withDrop = (pose: Pose, drop: number): Pose => ({ ...pose, fy: pose.fy + drop * DROP });
