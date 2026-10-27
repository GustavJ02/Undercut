/** Parametric livery shapes in car-local units: the car points along +x, is 1 long and about 0.5 wide with wheels, centred on the origin.
 * Pure data, so it is tested without a renderer; `TrackScene` draws it with Pixi, and the pit-wall scene will reuse it larger.
 * The designs are generic motorsport styling (stripes, bands, chevrons), original to this project and not modelled on any
 * real team's colours. Colour slots are filled from the pack: primary body, secondary pattern, accent details. */
import type { Pattern } from "../packs/types";

export type Slot = "primary" | "secondary" | "accent" | "dark" | "helmet";
export type Shape = { kind: "poly"; slot: Slot; pts: [number, number][] } | { kind: "circle"; slot: Slot; x: number; y: number; r: number };

export const BODY: [number, number][] = [[0.5, 0], [0.3, 0.1], [0, 0.15], [-0.3, 0.13], [-0.42, 0.11], [-0.42, -0.11], [-0.3, -0.13], [0, -0.15], [0.3, -0.1]];

const rect = (x0: number, x1: number, y0: number, y1: number, slot: Slot): Shape => ({ kind: "poly", slot, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

/** Wheels, wings and nose: the same for every car, accent-coloured where it is trim. */
export const PARTS: Shape[] = [
  rect(-0.5, -0.43, -0.24, 0.24, "accent"), // rear wing
  rect(0.38, 0.47, -0.27, 0.27, "accent"), // front wing
  rect(0.18, 0.34, -0.25, -0.15, "dark"), rect(0.18, 0.34, 0.15, 0.25, "dark"), // front wheels
  rect(-0.38, -0.2, -0.25, -0.14, "dark"), rect(-0.38, -0.2, 0.14, 0.25, "dark"), // rear wheels
];

export const PATTERN_SHAPES: Record<Pattern, Shape[]> = {
  solid: [],
  stripe: [rect(-0.42, 0.38, -0.045, 0.045, "secondary")],
  hoops: [rect(-0.2, -0.13, -0.11, 0.11, "secondary"), rect(0.05, 0.12, -0.11, 0.11, "secondary")],
  chevron: [
    { kind: "poly", slot: "secondary", pts: [[0.2, 0.0], [0.0, 0.11], [-0.08, 0.11], [0.12, 0.0], [-0.08, -0.11], [0.0, -0.11]] },
    { kind: "poly", slot: "secondary", pts: [[-0.12, 0.0], [-0.26, 0.11], [-0.34, 0.11], [-0.2, 0.0], [-0.34, -0.11], [-0.26, -0.11]] },
  ],
  split: [{ kind: "poly", slot: "secondary", pts: [[0.47, 0.0], [0.3, 0.094], [0, 0.144], [-0.3, 0.124], [-0.41, 0.104], [-0.41, 0.0]] }],
  diagonal: [{ kind: "poly", slot: "secondary", pts: [[-0.05, 0.12], [0.06, 0.12], [-0.1, -0.12], [-0.21, -0.12]] }],
  dots: [{ kind: "circle", slot: "secondary", x: 0.2, y: 0, r: 0.04 }, { kind: "circle", slot: "secondary", x: 0.0, y: 0.075, r: 0.04 }, { kind: "circle", slot: "secondary", x: 0.0, y: -0.075, r: 0.04 }, { kind: "circle", slot: "secondary", x: -0.2, y: 0, r: 0.04 }],
};

export function inPolygon(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A texture cache key: two cars with the same key can share a texture (the number is drawn separately, upright). */
export const liveryKey = (l: { primary: string; secondary: string; accent: string; pattern: Pattern }) => `${l.pattern}|${l.primary}|${l.secondary}|${l.accent}`;
