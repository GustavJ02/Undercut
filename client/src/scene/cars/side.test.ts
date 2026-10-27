import { describe, expect, it } from "vitest";
import type { Pattern } from "../../packs/types";
import { BODY_SIDE, NUMBER_AT, PARTS_SIDE, PATTERN_SIDE, inPolygon } from "./side";

const PATTERNS = Object.keys(PATTERN_SIDE) as Pattern[];

describe("side-view livery", () => {
  it("has a design for every pattern the pack schema allows", () => {
    expect([...PATTERNS].sort()).toEqual(["chevron", "diagonal", "dots", "hoops", "solid", "split", "stripe"]);
  });
  it("keeps every pattern shape inside the body", () => {
    for (const p of PATTERNS)
      for (const s of PATTERN_SIDE[p]) {
        const pts: [number, number][] = s.kind === "poly" ? s.pts : [[s.x + s.r, s.y], [s.x - s.r, s.y], [s.x, s.y + s.r], [s.x, s.y - s.r]];
        for (const pt of pts) expect(inPolygon(pt, BODY_SIDE), `${p} ${pt}`).toBe(true);
      }
  });
  it("gives each patterned livery different geometry", () => {
    expect(new Set(PATTERNS.map((p) => JSON.stringify(PATTERN_SIDE[p]))).size).toBe(PATTERNS.length);
  });
  it("sits on the ground and fits one car length", () => {
    const ys = [...BODY_SIDE.map((p) => p[1]), ...PARTS_SIDE.flatMap((s) => (s.kind === "poly" ? s.pts.map((p) => p[1]) : [s.y - s.r, s.y + s.r]))];
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.001);
    expect(Math.min(...ys)).toBeGreaterThan(-0.3);
    for (const s of PARTS_SIDE) for (const x of s.kind === "poly" ? s.pts.map((p) => p[0]) : [s.x - s.r, s.x + s.r]) expect(Math.abs(x)).toBeLessThanOrEqual(0.5001);
  });
  it("puts the number on the sidepod, inside the body", () => {
    expect(inPolygon([NUMBER_AT.x, NUMBER_AT.y], BODY_SIDE)).toBe(true);
  });
});

describe("the number on the side view", () => {
  it("sits clear of both wheels, which it used to overlap", () => {
    const wheels = PARTS_SIDE.filter((s) => s.kind === "circle" && s.slot === "dark") as { x: number; r: number }[];
    const half = 0.055; // two digits
    for (const w of wheels) expect(Math.abs(NUMBER_AT.x - w.x)).toBeGreaterThan(w.r + half);
  });
});
