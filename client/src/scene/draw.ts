/** Drawing the livery shapes (data in `livery.ts` and `cars/side.ts`) with Pixi. */
import type { Graphics } from "pixi.js";
import type { Shape } from "./livery";

export function drawShapes(g: Graphics, shapes: Shape[], colour: (slot: Shape["slot"]) => number, px: number): void {
  for (const s of shapes) {
    if (s.kind === "circle") g.circle(s.x * px, s.y * px, s.r * px).fill(colour(s.slot));
    else g.poly(s.pts.flatMap(([x, y]) => [x * px, y * px])).fill(colour(s.slot));
  }
}
