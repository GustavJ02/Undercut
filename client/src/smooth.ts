/** Client-side smoothing of car positions: the server sends a state every half second or so at 1x, and a dot that jumps that far
 * looks laggy. Between states a car is moved on at the speed it showed between the last two states. */

export interface Track {
  at: number; // when the latest state arrived (ms)
  interval: number; // time between the last two states (ms)
  frac: Record<string, number>;
  rate: Record<string, number>; // lap fraction per ms
}

export const MAX_STEP = 0.2; // a lap fraction jump larger than this (a lap wrap is fine, a teleport is not) is not smoothed
export const newTrack = (): Track => ({ at: -1, interval: 0, frac: {}, rate: {} });

/** The tracker after a new state: each car's speed is its movement since the previous state over the time between them. */
export function update(prev: Track, frac: Record<string, number>, now: number): Track {
  const interval = prev.at >= 0 ? now - prev.at : 0;
  const rate: Record<string, number> = {};
  for (const id of Object.keys(frac)) {
    const before = prev.frac[id];
    if (before === undefined || interval < 30 || interval > 3000) continue;
    let d = frac[id] - before;
    if (d < -0.5) d += 1; // crossed the line
    if (d >= 0 && d <= MAX_STEP) rate[id] = d / interval;
  }
  return { at: now, interval, frac, rate };
}

/** Where a car should be drawn at time `now`: the latest state plus up to 1.5 state intervals of movement; not at all when paused. */
export function position(t: Track, id: string, now: number, paused: boolean): number {
  const f = t.frac[id] ?? 0;
  const r = t.rate[id];
  if (paused || r === undefined) return f;
  const dt = Math.min(now - t.at, Math.max(t.interval, 100) * 1.5);
  return (f + r * dt) % 1;
}
