import { describe, expect, it } from "vitest";
import { buildOutline } from "../track";
import { outlineFor, sampleOutline, type Placed } from "./path";

const square = buildOutline([[0, 0], [1, 0], [1, 1], [0, 1]], 100, 0);

describe("sampleOutline", () => {
  it("walks the loop by arc length, with the heading of the segment", () => {
    const p: Placed = { x: 0, y: 0, heading: 0 };
    expect(sampleOutline(square, 0, p)).toMatchObject({ x: 0, y: 0, heading: 0 });
    sampleOutline(square, 0.125, p);
    expect([p.x, p.y]).toEqual([50, 0]);
    sampleOutline(square, 0.375, p);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(50);
    expect(p.heading).toBeCloseTo(Math.PI / 2);
  });
  it("wraps fractions below 0 and above 1 and reuses the output object", () => {
    const p: Placed = { x: 0, y: 0, heading: 0 };
    const q = sampleOutline(square, 1.125, p);
    expect(q).toBe(p);
    expect(p.x).toBeCloseTo(50);
    sampleOutline(square, -0.875, p);
    expect(p.x).toBeCloseTo(50);
  });
  it("has the real outline for known circuits and an oval for the rest", () => {
    expect(outlineFor("austin").pts.length).toBeGreaterThan(100);
    const oval = outlineFor("Nowhere");
    expect(oval.pts.length).toBe(120);
    expect(oval.cum[oval.pts.length]).toBeGreaterThan(300);
  });
});
