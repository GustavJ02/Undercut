import { describe, expect, it } from "vitest";
import type { Pattern } from "../packs/types";
import { BODY, PARTS, PATTERN_SHAPES, inPolygon, liveryKey } from "./livery";

const PATTERNS = Object.keys(PATTERN_SHAPES) as Pattern[];

describe("livery shapes", () => {
  it("has a design for every pattern the pack schema allows", () => {
    expect(PATTERNS.sort()).toEqual(["chevron", "diagonal", "dots", "hoops", "solid", "split", "stripe"]);
  });

  it("keeps every pattern shape inside the car body, so a livery never spills over the edge", () => {
    for (const p of PATTERNS)
      for (const s of PATTERN_SHAPES[p]) {
        const pts: [number, number][] = s.kind === "poly" ? s.pts : [[s.x + s.r, s.y], [s.x - s.r, s.y], [s.x, s.y + s.r], [s.x, s.y - s.r]];
        for (const pt of pts) expect(inPolygon(pt, BODY), `${p} ${pt}`).toBe(true);
      }
  });

  it("gives each patterned livery different geometry", () => {
    const sig = PATTERNS.map((p) => JSON.stringify(PATTERN_SHAPES[p]));
    expect(new Set(sig).size).toBe(PATTERNS.length);
  });

  it("keeps wheels and wings within a car-sized box", () => {
    for (const s of PARTS) if (s.kind === "poly") for (const [x, y] of s.pts) expect(Math.abs(x) <= 0.5 && Math.abs(y) <= 0.3).toBe(true);
  });

  it("shares textures between equal liveries only", () => {
    const a = { primary: "#111111", secondary: "#222222", accent: "#333333", pattern: "stripe" as const };
    expect(liveryKey(a)).toBe(liveryKey({ ...a }));
    expect(liveryKey(a)).not.toBe(liveryKey({ ...a, pattern: "dots" }));
    expect(liveryKey(a)).not.toBe(liveryKey({ ...a, primary: "#111112" }));
  });
});
