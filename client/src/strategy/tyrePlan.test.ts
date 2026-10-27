import { describe, expect, it } from "vitest";
import type { CompoundGuide, TyreGuide } from "../types";
import { bestPlans, lapCost, stintCosts } from "./tyrePlan";

const g = (pace: number, wear: number, onset: number): CompoundGuide => ({ pace_s: pace, wear_s_per_lap: wear, cliff_s_per_lap: 0.3, cliff_age: [onset], cliff_cdf: [1] });
const guide: TyreGuide = { compounds: { SOFT: g(-0.5, 0.1, 12), MEDIUM: g(0, 0.05, 25), HARD: g(0.3, 0.03, 40) }, stops: { "1": 1 } };

describe("tyre plan", () => {
  it("costs a stint by pace, wear and the cliff", () => {
    expect(lapCost(guide.compounds.MEDIUM, 10)).toBeCloseTo(0.5);
    expect(lapCost(guide.compounds.SOFT, 14)).toBeCloseTo(-0.5 + 1.4 + 0.6);
    expect(stintCosts(guide.compounds.HARD, 2)[2]).toBeCloseTo(0.3 + 0.03 + 0.3 + 0.06);
  });

  it("every plan uses two compounds and adds the pit losses", () => {
    const plans = bestPlans(guide, 50, 20);
    for (const c of ["SOFT", "MEDIUM", "HARD"] as const) {
      const p = plans[c]!;
      expect(p.stints[0].compound).toBe(c);
      expect(new Set(p.stints.map((s) => s.compound)).size).toBeGreaterThan(1);
      expect(p.stints.reduce((a, s) => a + s.laps, 0)).toBe(50);
      expect(p.delta).toBeGreaterThanOrEqual(0);
    }
    expect(Math.min(...Object.values(plans).map((p) => p!.delta))).toBe(0);
  });

  it("a costly stop pushes the best plan to fewer stops", () => {
    const stops = (loss: number) => bestPlans(guide, 60, loss).MEDIUM!.stints.length - 1;
    expect(stops(60)).toBeLessThanOrEqual(stops(5));
    expect(stops(60)).toBe(1);
  });
});
