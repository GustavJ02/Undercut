import { describe, expect, it } from "vitest";
import { GRID_PX_PER_LAP, LAUNCH_RAMP_S, anchoredX, PX_PER_LAP, gridness, pxPerLap, trackX } from "./lane";

describe("the start", () => {
  it("shows the whole grid on the grid and opens up to the racing scale after lights out", () => {
    expect(pxPerLap("GRID", null)).toBe(GRID_PX_PER_LAP);
    expect(pxPerLap("RACING", null)).toBe(PX_PER_LAP);
    expect(pxPerLap("RACING", 0)).toBe(GRID_PX_PER_LAP);
    expect(pxPerLap("RACING", LAUNCH_RAMP_S)).toBe(PX_PER_LAP);
    const mid = pxPerLap("RACING", LAUNCH_RAMP_S / 2);
    expect(mid).toBeGreaterThan(GRID_PX_PER_LAP);
    expect(mid).toBeLessThan(PX_PER_LAP);
    expect(gridness(GRID_PX_PER_LAP)).toBe(1);
    expect(gridness(PX_PER_LAP)).toBe(0);
    // 22 cars 0.4 s apart on a 75 s lap all fit on screen
    for (let slot = 1; slot <= 22; slot++) expect(trackX(1 - (slot * 0.4) / 75, GRID_PX_PER_LAP)).not.toBeNull();
  });
});

describe("the launch", () => {
  it("never moves a car backwards while the scale opens up", () => {
    const slot = 1 - 12 * 0.0053; // twelfth on the grid
    let last = -Infinity;
    for (let t = 0; t <= 16; t += 0.05) {
      const travelled = Math.min(0.0133 * t * Math.min(t / 4, 1), 0.2); // accelerating, never backwards
      const x = anchoredX(slot, (slot + travelled) % 1, pxPerLap("RACING", t));
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
  });
  it("starts at the car's slot in the grid scale and ignores a hair of jitter behind it", () => {
    const slot = 0.97;
    expect(anchoredX(slot, slot, GRID_PX_PER_LAP)).toBeCloseTo(trackX(slot, GRID_PX_PER_LAP)!);
    expect(anchoredX(slot, slot - 1e-5, PX_PER_LAP)).toBeCloseTo(trackX(slot, GRID_PX_PER_LAP)!);
  });
});
