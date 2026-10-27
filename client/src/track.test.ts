import { describe, expect, it } from "vitest";
import { buildOutline, finishLine, outlinePath, outlinePoint } from "./track";
import { TRACKS } from "./circuits";

// Unit square, start at the origin corner going right; side length 1 so the loop length is 4.
const square = buildOutline([[0, 0], [1, 0], [1, 1], [0, 1]], 100, 0);

describe("outline mapping", () => {
  it("maps the endpoints and quarter laps by arc length", () => {
    expect(outlinePoint(square, 0)).toEqual({ x: 0, y: 0 });
    expect(outlinePoint(square, 0.25)).toEqual({ x: 100, y: 0 });
    expect(outlinePoint(square, 0.125)).toEqual({ x: 50, y: 0 });
    expect(outlinePoint(square, 0.875)).toEqual({ x: 0, y: 50 });
  });

  it("wraps at 1.0 and for negative fractions", () => {
    expect(outlinePoint(square, 1)).toEqual(outlinePoint(square, 0));
    const a = outlinePoint(square, 1.375);
    const b = outlinePoint(square, 0.375);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(outlinePoint(square, -0.125).y).toBeCloseTo(50);
  });

  it("advances monotonically along the loop with uniform speed on a real outline", () => {
    const o = buildOutline(TRACKS.austin);
    const pts = Array.from({ length: 1001 }, (_, i) => outlinePoint(o, i / 1000));
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    expect(Math.max(...steps)).toBeLessThan(o.cum[o.pts.length] / 1000 * 1.001);
    expect(pts[1000].x).toBeCloseTo(pts[0].x);
    expect(pts[1000].y).toBeCloseTo(pts[0].y);
  });

  it("builds a closed path and a finish line across the direction of travel", () => {
    expect(outlinePath(square)).toBe("M0.0 0.0L100.0 0.0L100.0 100.0L0.0 100.0Z");
    const f = finishLine(square, 5);
    expect(f).toEqual({ x1: 0, y1: 5, x2: 0, y2: -5 });
  });

  it("sizes the view box to the outline's aspect ratio", () => {
    const o = buildOutline([[0, 0], [1, 0], [1, 0.5], [0, 0.5]], 200, 10);
    expect(o.width).toBe(220);
    expect(o.height).toBe(120);
  });
});
