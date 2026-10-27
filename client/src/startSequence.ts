/** The start: five lights come on one by one, are held, and go out; the race starts when they do. Presentation only, on this client's
 * own clock: the server is told to start when the lights go out, and the scene and the sound both read the same timing from here. */
export const LIGHTS = 5;
export const STEP_S = 0.9; // one light every 0.9 s
export const FIRST_S = 0.4; // the first light, after the button
export const HOLD_MIN_S = 0.8;
export const HOLD_MAX_S = 2.6; // the lights are held a random time, as in the real start

export const lightTime = (i: number): number => FIRST_S + i * STEP_S;
export const totalS = (hold: number): number => lightTime(LIGHTS - 1) + hold;
export const randomHold = (rand: number): number => HOLD_MIN_S + rand * (HOLD_MAX_S - HOLD_MIN_S);

/** How many lights are on `elapsed` seconds into the sequence. */
export const litAt = (elapsed: number): number => Math.max(0, Math.min(LIGHTS, Math.floor((elapsed - FIRST_S) / STEP_S) + 1));

let begunAt: number | null = null;

export const startSeq = {
  begin(): void {
    begunAt = performance.now() / 1000;
  },
  end(): void {
    begunAt = null;
  },
  /** Lights on now, or null when no start is in progress. */
  lit(): number | null {
    return begunAt === null ? null : litAt(performance.now() / 1000 - begunAt);
  },
};
