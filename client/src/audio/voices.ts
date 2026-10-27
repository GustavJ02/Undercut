/** The parameters of the synthesised sounds, as pure functions, so the shape of a sound is tested as numbers: the pitch bend of a
 * passing car, its loudness over the pass, when the ambience clanks, how a stop's guns are spaced, and which passes make a sound. */
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const smooth = (t: number) => t * t * (3 - 2 * t);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export interface PassVoice {
  duration: number; // wall seconds from entering the screen to leaving it
  baseHz: number; // the engine note when level with the camera
  gain: number;
  panFrom: number;
  panTo: number;
}

/** Screen width a pass covers, in design pixels, and the shortest and longest a pass is allowed to last. */
export const PASS_SPAN_PX = 2560;
export const PASS_MIN_S = 0.3;
export const PASS_MAX_S = 3.2;

/** `screenSpeed` is how fast the car crosses the screen in design pixels per wall second; `simSpeed` the race's speed multiplier, which
 * makes a crowd of passes quieter so ten times speed is not ten times the noise. */
export function passVoice(carId: string, screenSpeed: number, simSpeed = 1): PassVoice {
  return {
    duration: clamp(PASS_SPAN_PX / Math.max(screenSpeed, 1), PASS_MIN_S, PASS_MAX_S),
    baseHz: 88 + (hash(carId) % 46), // each car has its own note
    gain: 0.5 * clamp(3 / (simSpeed + 2), 0.3, 1),
    panFrom: -0.85,
    panTo: 0.85,
  };
}

/** The Doppler ratio at fraction `u` of the pass: higher while it approaches, lower after, with the fastest drop as it goes by. */
export const dopplerAt = (u: number): number => 1.17 - 0.34 * smooth(clamp(u, 0, 1));

/** Loudness over the pass: a swell that peaks as the car is level with the camera. */
export const swellAt = (u: number): number => Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 1.6);

/** Seconds until the next clank in the garage ambience, from a random number in [0, 1). */
export const nextClankDelay = (rand: number): number => 3 + rand * 7;

/** When each wheel gun fires, in seconds after the stop starts: four guns a little apart. */
export const gunTimes = (n = 4, spacing = 0.09): number[] => Array.from({ length: n }, (_, i) => i * spacing);

/** Decides which cars make a pass-by sound: one when a car comes onto the screen from the left, never more than `perSecond` in a second,
 * and never more than `maxVoices` sounding at once. Pure and driven by time passed in. */
export class PassGate {
  private recent: number[] = [];
  private seen = new Set<string>();
  private ending: number[] = [];

  constructor(private perSecond = 5, private maxVoices = 6) {}

  /** `onScreen` lists the cars on screen now and whether each came in from the left; returns the cars to sound. */
  update(onScreen: { id: string; fromLeft: boolean }[], nowMs: number, durationMs: (id: string) => number): string[] {
    const present = new Set(onScreen.map((c) => c.id));
    for (const id of [...this.seen]) if (!present.has(id)) this.seen.delete(id);
    this.recent = this.recent.filter((t) => nowMs - t < 1000);
    this.ending = this.ending.filter((t) => t > nowMs);
    const fire: string[] = [];
    for (const c of onScreen) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      if (!c.fromLeft || this.recent.length >= this.perSecond || this.ending.length >= this.maxVoices) continue;
      this.recent.push(nowMs);
      this.ending.push(nowMs + durationMs(c.id));
      fire.push(c.id);
    }
    return fire;
  }
}
