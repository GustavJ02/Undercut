import type { CompoundGuide, TyreGuide } from "../types";

type Dry = "SOFT" | "MEDIUM" | "HARD";
const DRY: Dry[] = ["SOFT", "MEDIUM", "HARD"];
const MIN_STINT = 5;

export interface PlanStint {
  compound: Dry;
  laps: number;
}
export interface Plan {
  stints: PlanStint[];
  total: number; // seconds against a fresh medium for the whole distance, pit stops included
  delta: number; // seconds behind the best plan
}

/** Mean extra seconds a tyre of this age costs for the cliff, over where the cliff may start: the guide gives it as a distribution. */
function cliffCost(g: CompoundGuide, age: number): number {
  let cost = 0;
  let prev = 0;
  for (let i = 0; i < g.cliff_age.length; i++) {
    const p = g.cliff_cdf[i] - prev;
    prev = g.cliff_cdf[i];
    if (p > 0) cost += p * Math.max(0, age - g.cliff_age[i]);
  }
  return cost * g.cliff_s_per_lap;
}

/** Seconds a stint of 1..n laps costs on this compound, cumulative: pace, wear and the expected cliff. */
export function stintCosts(g: CompoundGuide, n: number): number[] {
  const out = [0];
  for (let a = 1; a <= n; a++) out.push(out[a - 1] + g.pace_s + g.wear_s_per_lap * a + cliffCost(g, a));
  return out;
}

/** Expected tyre time of a stint length as a per-lap series, for the chart: the cost of the lap at that age. */
export const lapCost = (g: CompoundGuide, age: number) => g.pace_s + g.wear_s_per_lap * age + cliffCost(g, age);

/**
 * The best plan for each starting compound, with one or two stops and at least two different compounds, as the model of the
 * guide sees it: tyre time and pit losses only, so no traffic, safety cars or weather. Ranked by seconds behind the best.
 */
export function bestPlans(guide: TyreGuide, laps: number, pitLoss: number): Record<Dry, Plan | null> {
  const cost = Object.fromEntries(DRY.map((c) => [c, stintCosts(guide.compounds[c], laps)])) as Record<Dry, number[]>;
  const best: Record<Dry, Plan | null> = { SOFT: null, MEDIUM: null, HARD: null };
  const offer = (stints: PlanStint[], total: number) => {
    const start = stints[0].compound;
    if (new Set(stints.map((s) => s.compound)).size < 2) return;
    if (!best[start] || total < best[start]!.total) best[start] = { stints, total, delta: 0 };
  };
  for (const a of DRY) {
    for (const b of DRY) {
      for (let k = MIN_STINT; k <= laps - MIN_STINT; k++) {
        offer([{ compound: a, laps: k }, { compound: b, laps: laps - k }], cost[a][k] + cost[b][laps - k] + pitLoss);
        for (const c of DRY) {
          for (let m = k + MIN_STINT; m <= laps - MIN_STINT; m++) {
            offer([{ compound: a, laps: k }, { compound: b, laps: m - k }, { compound: c, laps: laps - m }], cost[a][k] + cost[b][m - k] + cost[c][laps - m] + 2 * pitLoss);
          }
        }
      }
    }
  }
  const top = Math.min(...DRY.map((c) => best[c]?.total ?? Infinity));
  for (const c of DRY) if (best[c]) best[c]!.delta = best[c]!.total - top;
  return best;
}
