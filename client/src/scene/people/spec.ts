/** Parametric characters as data: proportions, colours and parts from a pack archetype and a team's kit colours, with no drawing code,
 * so they are tested without a renderer. People are archetypes (a build, a height, a hairstyle, a skin tone), never likenesses of
 * real people. Units are pixels in design space with the feet at (0, 0) and up as negative y. */
import type { Archetype } from "../../packs/types";

export type Facing = "away" | "toward";
export type Role = "crew" | "engineer" | "strategist" | "driver";
export type Prop = "none" | "gun" | "jack" | "lollipop" | "tablet" | "helmet";

export const BASE_HEIGHT = 66;

export interface CharacterSpec {
  role: Role;
  facing: Facing;
  height: number;
  torsoW: number;
  legW: number;
  armW: number;
  headR: number;
  skin: number;
  hair: Archetype["hair"];
  hairColour: number;
  trousers: number;
  kit: number; // torso and arms
  trim: number; // stripe, sleeve cuff
  headwear: "helmet" | "headset" | "none";
  helmetColour: number;
  prop: Prop;
}

const BUILD_W: Record<Archetype["build"], { torso: number; leg: number; arm: number }> = {
  lean: { torso: 15, leg: 5, arm: 4.2 },
  medium: { torso: 18, leg: 6, arm: 5 },
  broad: { torso: 22, leg: 7, arm: 6 },
};

const HAIR_TONES = [0x1c1612, 0x3a2a1c, 0x6b4a2b, 0xb98a4a, 0x8c3d1f, 0x2b2b30];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
export const hexNum = (c: string): number => parseInt(c.slice(1), 16);

/** `seed` varies the hair tone between people who share an archetype. */
export function characterSpec(a: Archetype, o: { kit: string; helmet: string; trim: string; facing: Facing; seed: string; prop?: Prop }): CharacterSpec {
  const w = BUILD_W[a.build];
  const kit = hexNum(o.kit);
  const driver = a.role === "driver";
  return {
    role: a.role,
    facing: o.facing,
    height: BASE_HEIGHT * a.height,
    torsoW: w.torso,
    legW: w.leg,
    armW: w.arm,
    headR: 0.11 * BASE_HEIGHT * a.height,
    skin: hexNum(a.skin),
    hair: a.hair,
    hairColour: HAIR_TONES[hash(o.seed) % HAIR_TONES.length],
    trousers: driver ? kit : 0x20242c,
    kit,
    trim: hexNum(o.trim),
    headwear: a.role === "crew" ? "helmet" : a.role === "driver" ? "none" : "headset",
    helmetColour: hexNum(o.helmet),
    prop: o.prop ?? (a.role === "driver" ? "helmet" : "none"),
  };
}

/** The shoulder and head anchor points the rig and its animations hang from. */
export function anchors(s: CharacterSpec): { shoulderY: number; shoulderX: number; headY: number; hipY: number; armLen: number; torsoTop: number } {
  const hipY = -0.42 * s.height;
  const torsoTop = -0.78 * s.height;
  return { hipY, torsoTop, shoulderY: torsoTop + 3, shoulderX: s.torsoW / 2 + s.armW / 2 - 1, headY: torsoTop - s.headR + 1, armLen: 0.3 * s.height };
}
