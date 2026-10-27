/** Poses and clips for the characters: pure functions of time, so animation quality is tested as numbers. A pose is angles and offsets;
 * the Pixi rig applies it. Arm angles are measured from hanging straight down, positive swinging outward and up (pi is straight up);
 * `bob` is a vertical offset in pixels (up positive), `squash` shortens the legs (1 is standing), `lean` tilts the torso in radians. */
export interface Pose {
  armL: number;
  armR: number;
  bob: number;
  squash: number;
  lean: number;
  headTilt: number;
  hop: number; // pixels the whole body is off the ground
  sign: "off" | "red" | "green"; // the lollipop board
}

export const REST: Pose = { armL: 0.08, armR: 0.08, bob: 0, squash: 1, lean: 0, headTilt: 0, hop: 0, sign: "off" };

export type ClipName = "idle" | "ready" | "gun" | "jack" | "lollipopRed" | "lollipopGreen" | "radio" | "point" | "crossed" | "cheer" | "tablet" | "gloom";

/** How long a clip lasts in wall seconds; null clips loop until replaced. */
export const CLIP_SECONDS: Record<ClipName, number | null> = {
  idle: null, ready: null, gun: 1.8, jack: 2.2, lollipopRed: null, lollipopGreen: 1.2, radio: null, point: 3.5, crossed: null, cheer: null, tablet: null, gloom: null,
};

const TAU = Math.PI * 2;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
/** Blend in over `s` seconds so a clip never snaps. */
const inRamp = (t: number, s = 0.25) => smooth(clamp01(t / s));

/** `t` is seconds since the clip started, `phase` a per-person offset so a line of people does not move in step. */
export function poseAt(clip: ClipName, t: number, phase = 0): Pose {
  const k = inRamp(t);
  const breathe = Math.sin((t + phase) * TAU * 0.25);
  const idle: Pose = { ...REST, bob: 0.5 * breathe, armL: 0.08 + 0.04 * breathe, armR: 0.08 - 0.04 * breathe, headTilt: 0.04 * Math.sin((t + phase) * TAU * 0.11) };
  const mix = (target: Pose): Pose => ({
    armL: idle.armL + (target.armL - idle.armL) * k, armR: idle.armR + (target.armR - idle.armR) * k, bob: idle.bob + (target.bob - idle.bob) * k,
    squash: idle.squash + (target.squash - idle.squash) * k, lean: idle.lean + (target.lean - idle.lean) * k, headTilt: idle.headTilt + (target.headTilt - idle.headTilt) * k,
    hop: target.hop * k, sign: target.sign,
  });
  switch (clip) {
    case "idle":
      return idle;
    case "ready": // crouched, hands out, a small tremble of readiness
      return mix({ ...REST, squash: 0.86, bob: -3, lean: 0.12, armL: 0.95 + 0.03 * Math.sin((t + phase) * TAU * 3), armR: 0.95 - 0.03 * Math.sin((t + phase) * TAU * 3), headTilt: 0 });
    case "gun": { // the wheel gun: a fast shake of the working arm, body leaning in
      const shake = Math.sin(t * TAU * 11);
      return mix({ ...REST, squash: 0.84, bob: -4, lean: 0.16, armL: 0.7, armR: 0.95 + 0.18 * shake });
    }
    case "jack": { // up with the car, then down
      const up = Math.sin(clamp01(t / 2.2) * Math.PI);
      return mix({ ...REST, squash: 0.9 - 0.06 * up, bob: -2, lean: 0.1, armL: 0.5 + 1.2 * up, armR: 0.5 + 1.2 * up });
    }
    case "lollipopRed":
      return mix({ ...REST, armR: 0.55 + 0.04 * Math.sin((t + phase) * TAU * 0.6), armL: 0.1, sign: "red" });
    case "lollipopGreen":
      return mix({ ...REST, armR: 0.55, armL: 0.1, sign: "green" });
    case "radio": // a hand to the headset
      return mix({ ...REST, armR: 2.55, armL: 0.1, headTilt: 0.12 });
    case "point": // pointing up and out at the sky
      return mix({ ...REST, armR: 2.2 + 0.05 * Math.sin(t * TAU * 1.5), armL: 0.1, headTilt: -0.12 });
    case "crossed": // arms folded
      return mix({ ...REST, armL: -0.7, armR: -0.7, headTilt: 0.05 });
    case "cheer": { // both arms up and a bounce
      const b = Math.abs(Math.sin((t + phase) * TAU * 1.4));
      return mix({ ...REST, armL: 2.7 + 0.2 * Math.sin((t + phase) * TAU * 2.8), armR: 2.7 - 0.2 * Math.sin((t + phase) * TAU * 2.8), hop: 9 * b, squash: 0.96, headTilt: -0.06 });
    }
    case "tablet": // head down, arms in front
      return mix({ ...REST, armL: -0.45, armR: -0.45, headTilt: 0.2, lean: 0.04 });
    case "gloom": // hands on head: a retired driver
      return mix({ ...REST, armL: 2.9, armR: 2.9, headTilt: 0.18, lean: -0.03 });
  }
}

/** A clip that has run its time, so the director can fall back to idle. */
export const finished = (clip: ClipName, t: number): boolean => CLIP_SECONDS[clip] !== null && t >= CLIP_SECONDS[clip]!;
