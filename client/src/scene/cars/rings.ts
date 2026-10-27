/** The coloured ring on the sidewall that tells the compound: red soft, yellow medium, white hard, green intermediate, blue wet. Drawn over
 * the car's wheels in the texture's units (one car length is `units`), so it scales with the car. */
import type { Graphics } from "pixi.js";
import type { Compound } from "../../contract/types";

export const RING_COLOUR: Record<Compound, number> = {
  SOFT: 0xe8334a,
  MEDIUM: 0xf2c230,
  HARD: 0xf2f4f8,
  INTERMEDIATE: 0x35c27a,
  WET: 0x4b8bff,
};

/** Wheel centres and ring radii of the side view (see PARTS_SIDE: the tyres are a little bigger than the ring). */
const WHEELS = [
  { x: 0.28, y: -0.075, r: 0.058 },
  { x: -0.3, y: -0.085, r: 0.067 },
] as const;

export function drawTyreRings(g: Graphics, units: number, compound: Compound | null): void {
  g.clear();
  if (!compound) return;
  for (const w of WHEELS) g.circle(w.x * units, w.y * units, w.r * units).stroke({ width: 0.016 * units, color: RING_COLOUR[compound] });
}
