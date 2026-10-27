import type { DebriefDecision, DebriefOption, DebriefReport, DebriefSummary } from "./types";

/** A number to one decimal that never prints as "-0.0": anything that rounds to zero is plain 0.0. */
export function fixed(x: number, digits = 1): string {
  const s = Math.abs(x).toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : x < 0 ? `−${s}` : s;
}

/** The same with an explicit sign: +4.7, −2.5, 0.0. */
export const signed = (x: number, digits = 1): string => {
  const s = fixed(x, digits);
  return Number(s.replace("−", "-")) > 0 ? `+${s}` : s;
};

/** "Position" for a place count: "P9.0". */
export const place = (x: number): string => `P${x.toFixed(1)}`;

/** Is a difference clearly more than noise? Two standard errors. */
export const clear = (x: number, se: number) => Math.abs(x) > 2 * se && Math.abs(x) >= 0.5;

/** Skill and luck in plain words, one sentence each, so neither can be mistaken for the other. */
export function verdict(s: DebriefSummary): { skill: string; luck: string } {
  const skill = s.skill_points;
  const se = s.skill_points_se;
  const skillText = !clear(skill, se)
    ? "Skill: your calls were about as good as the default strategy; any difference is within the noise."
    : skill > 0
      ? `Skill: your calls were clearly better than the default strategy, worth ${signed(skill)} points on average. That part is not luck.`
      : `Skill: your calls were clearly worse than the default strategy, costing ${Math.abs(skill).toFixed(1)} points on average. That part is not luck.`;
  const swing = s.expected_points_sd;
  const luck = s.luck_points;
  const spread = swing < 1 ? swing.toFixed(1) : swing.toFixed(0);
  const luckText =
    swing < 0.5 && Math.abs(luck) < 0.5
      ? "Luck: hardly any; your calls scored about the same in every simulated future."
      : Math.abs(luck) < 0.5 * swing
      ? `Luck: the race went about as expected from your calls (${signed(luck)} points; a normal swing is ±${swing.toFixed(0)}).`
      : luck > 0
        ? `Luck: the race itself went better than your calls would usually give, ${signed(luck)} points (a normal swing is ±${spread}).`
        : `Luck: the race itself went worse than your calls would usually give, ${signed(luck)} points (a normal swing is ±${spread}).`;
  return { skill: skillText, luck: luckText };
}

/** An option's gain over the taken one with its uncertainty: "−2.5 ± 1.1 pts, places −0.8". The taken option has no difference to show. */
export function deltaText(o: DebriefOption): string {
  if (o.taken) return "taken";
  return `${signed(o.delta_points)} ± ${fixed(o.delta_points_se)} pts, places ${signed(o.places)}`;
}

export const VERDICT_TEXT: Record<DebriefOption["verdict"], string> = { taken: "taken", better: "better", worse: "worse", same: "no meaningful difference" };

/** A decision worth opening: a meaningful miss, or a contribution clearly different from zero. The rest collapse to one line. */
export function meaningful(d: DebriefDecision): boolean {
  return d.significant || clear(d.contribution_points, d.contribution_points_se) || d.options.some((o) => o.verdict === "worse");
}

/** The decision with the biggest miss, if any miss is meaningful, and the decision with the largest negative contribution when that is
 * a different one and clearly below zero. */
export function headlines(r: DebriefReport): { miss: DebriefDecision | null; costly: DebriefDecision | null } {
  const byIndex = (i: number | null) => r.decisions.find((d) => d.index === i) ?? null;
  const missD = byIndex(r.summary.biggest_miss);
  const miss = missD && missD.significant ? missD : null;
  const worst = byIndex(r.summary.worst_contribution);
  const costly = worst && worst !== miss && worst.contribution_points < 0 && clear(worst.contribution_points, worst.contribution_points_se) ? worst : null;
  return { miss, costly };
}

/** Bars for one decision on a shared scale: the zero line is the taken option; each other option is a bar to its difference with a whisker
 * of two standard errors (the bar the verdict uses), so "clearly worse" and "within noise" differ by whether the whisker crosses zero. */
export function barScale(options: DebriefOption[]): { lo: number; hi: number } {
  const reach = Math.max(1, ...options.map((o) => Math.abs(o.delta_points) + 2 * o.delta_points_se));
  return { lo: -reach, hi: reach };
}
