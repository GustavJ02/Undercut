/** The side view of a car for the pass-bys: units are car lengths, the car faces +x with its wheels on y = 0 and up as negative y.
 * The same livery parameters as the top-down car (primary, secondary and accent colours, a pattern, a number), so one team looks the
 * same from both views. Pure data; generic motorsport shapes, not any real car. */
import type { Pattern } from "../../packs/types";
import { inPolygon, type Shape } from "../livery";

export const BODY_SIDE: [number, number][] = [
  [-0.44, -0.04], [-0.44, -0.14], [-0.31, -0.17], [-0.15, -0.255], [-0.05, -0.255], [0.03, -0.17], [0.2, -0.12], [0.47, -0.07], [0.47, -0.05], [0.3, -0.04],
];

const poly = (slot: Shape["slot"], pts: [number, number][]): Shape => ({ kind: "poly", slot, pts });
const circle = (slot: Shape["slot"], x: number, y: number, r: number): Shape => ({ kind: "circle", slot, x, y, r });

/** Wheels, wings, halo and helmet: the same for every car. */
export const PARTS_SIDE: Shape[] = [
  poly("accent", [[-0.5, -0.27], [-0.43, -0.27], [-0.43, -0.09], [-0.5, -0.09]]), // rear wing endplate
  poly("accent", [[-0.5, -0.27], [-0.38, -0.27], [-0.38, -0.245], [-0.5, -0.245]]), // wing element
  poly("accent", [[0.4, -0.065], [0.5, -0.065], [0.5, -0.03], [0.4, -0.03]]), // front wing
  poly("accent", [[0.4, -0.105], [0.44, -0.105], [0.5, -0.05], [0.5, -0.03], [0.4, -0.03]]), // endplate: tall at the back, falling away to the front
  circle("dark", 0.28, -0.075, 0.075),
  circle("dark", -0.3, -0.085, 0.085),
  circle("accent", 0.28, -0.075, 0.03),
  circle("accent", -0.3, -0.085, 0.034),
  circle("helmet", -0.02, -0.215, 0.04), // the driver
  poly("dark", [[-0.09, -0.255], [-0.09, -0.285], [0.04, -0.285], [0.06, -0.19], [0.045, -0.19], [0.03, -0.265], [-0.07, -0.265], [-0.07, -0.255]]), // halo
];

export const PATTERN_SIDE: Record<Pattern, Shape[]> = {
  solid: [],
  stripe: [poly("secondary", [[-0.42, -0.135], [0.1, -0.135], [0.1, -0.105], [-0.42, -0.105]])],
  hoops: [poly("secondary", [[-0.28, -0.17], [-0.21, -0.19], [-0.21, -0.05], [-0.28, -0.05]]), poly("secondary", [[0.06, -0.15], [0.12, -0.13], [0.12, -0.05], [0.06, -0.05]])],
  chevron: [
    poly("secondary", [[-0.36, -0.15], [-0.28, -0.15], [-0.2, -0.1], [-0.28, -0.055], [-0.36, -0.055], [-0.28, -0.1]]),
    poly("secondary", [[-0.2, -0.15], [-0.12, -0.15], [-0.04, -0.1], [-0.12, -0.055], [-0.2, -0.055], [-0.12, -0.1]]),
  ],
  split: [poly("secondary", [[-0.43, -0.095], [0.3, -0.095], [0.3, -0.045], [-0.43, -0.045]])],
  diagonal: [poly("secondary", [[-0.2, -0.16], [-0.12, -0.19], [-0.02, -0.05], [-0.1, -0.05]])],
  dots: [circle("secondary", -0.35, -0.1, 0.022), circle("secondary", -0.25, -0.1, 0.022), circle("secondary", -0.15, -0.1, 0.022), circle("secondary", -0.05, -0.1, 0.022), circle("secondary", 0.07, -0.085, 0.022)],
};

/** Where the number goes: on the sidepod, between the wheels (two digits are about 0.1 long, so it clears both). */
export const NUMBER_AT = { x: -0.07, y: -0.105, size: 0.075 } as const;

export const SIDE_HEIGHT = 0.29;

export { inPolygon };
