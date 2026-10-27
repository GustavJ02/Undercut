import { Gloss } from "./Gloss";
import type { RaceInfo } from "../types";
import { niceTicks } from "../strategy/analysis";
import { bestPlans, lapCost } from "../strategy/tyrePlan";
import { Tyre } from "./Tyre";

const DRY = ["SOFT", "MEDIUM", "HARD"] as const;
const COLOR = { SOFT: "var(--soft)", MEDIUM: "var(--medium)", HARD: "var(--hard)" };
const W = 960, H = 240, PAD = { l: 48, r: 12, t: 12, b: 30 };

/** The age at which the cliff has started for this share of tyres. */
const cliffAt = (age: number[], cdf: number[], q: number) => age[Math.max(0, cdf.findIndex((x) => x >= q))];

/** Where the cliff starts for 1 in 10 and 9 in 10 tyres, said for this race's distance: ranges past the finish are cut off. */
export function cliffText(early: number, late: number, laps: number): string {
  if (early >= laps) return "not within this race";
  if (late >= laps) return `from lap ${early}, may not come`;
  return `laps ${early} to ${late}`;
}

/** What the team knows before lights out: the compounds as the whole field has run them, and what that adds up to over this distance. */
export function TyreGuide({ info, pitLoss }: { info: RaceInfo; pitLoss: number }) {
  const guide = info.tyre_guide;
  if (!guide) return null;
  const laps = info.total_laps;
  const plans = bestPlans(guide, laps, pitLoss);
  const maxAge = Math.min(laps, 40);
  const ages = Array.from({ length: maxAge }, (_, i) => i + 1);
  const series = DRY.map((c) => ages.map((a) => lapCost(guide.compounds[c], a)));
  const lo = Math.min(0, ...series.flat()), hi = Math.min(Math.max(...series.flat(), 0.5), 3);
  const clamp = (v: number) => Math.min(v, hi);
  const x = (a: number) => PAD.l + ((a - 1) / (maxAge - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const stopShare = (n: string) => Math.round(((guide.stops[n] ?? 0) / Object.values(guide.stops).reduce((a, b) => a + b, 0)) * 100);
  const scChance = info.sc_rate_per_lap == null ? null : Math.round((1 - Math.exp(-info.sc_rate_per_lap * laps)) * 100);
  const full = info.full_laps ?? laps;
  const anyCliff = DRY.some((c) => cliffAt(guide.compounds[c].cliff_age, guide.compounds[c].cliff_cdf, 0.1) < maxAge);
  const ranked = DRY.filter((c) => plans[c]).sort((a, b) => plans[a]!.delta - plans[b]!.delta);
  return (
    <section className="tyre-guide">
      <h3>Tyre guide</h3>
      <p className="muted small">
        Averages of how each compound behaves, not your own cars' tyres: those wear differently from lap to lap.
      </p>
      <table>
        <thead>
          <tr><th>Tyre</th><th title="Per lap against the medium">Pace</th><th title="Lap time lost for each lap of age">Wear</th><th title="Laps by which the cliff has started for 1 in 10 and for 9 in 10 tyres">Cliff</th></tr>
        </thead>
        <tbody>
          {DRY.map((c) => {
            const g = guide.compounds[c];
            return (
              <tr key={c}>
                <td><Tyre compound={c} /> {c.toLowerCase()}</td>
                <td>{g.pace_s === 0 ? "reference" : `${g.pace_s < 0 ? "" : "+"}${g.pace_s.toFixed(2)} s`}</td>
                <td>{g.wear_s_per_lap.toFixed(3)} s/lap</td>
                <td>{cliffText(cliffAt(g.cliff_age, g.cliff_cdf, 0.1), cliffAt(g.cliff_age, g.cliff_cdf, 0.9), laps)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="legend small">{DRY.map((c) => (<span key={c}><Tyre compound={c} /> {c.toLowerCase()}</span>))}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Seconds lost per lap against tyre age, per compound" className="tyre-chart">
        {niceTicks(lo, hi, 5).map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.l - 6} y={y(v) + 5} textAnchor="end" className="axis">{(Math.abs(v) < 1e-9 ? 0 : v).toFixed(1)}</text>
          </g>
        ))}
        {[1, ...niceTicks(1, maxAge, 6).filter((a) => a > 1 && a - 1 >= (maxAge - 1) / 12)].map((a) => (
          <text key={a} x={x(a)} y={H - 8} textAnchor="middle" className="axis">{a}</text>
        ))}
        {DRY.map((c, i) => (
          <g key={c}>
            <polyline fill="none" stroke={COLOR[c]} strokeWidth={2} points={ages.map((a, k) => `${x(a)},${y(clamp(series[i][k]))}`).join(" ")} />
          </g>
        ))}
      </svg>
      <p className="muted small chart-caption">Time against a new medium, per lap, by tyre age. {anyCliff ? <>The upturn is the average <Gloss term="tyre cliff">cliff</Gloss>; the chart stops at 3 s.</> : <>No tyre is expected to reach its <Gloss term="tyre cliff">cliff</Gloss> in {laps} laps; the chart stops at 3 s.</>}</p>
      <h4>Best plan for each starting tyre</h4>
      <p className="muted small">
        {laps} laps, <Gloss term="pit loss">pit loss</Gloss> {pitLoss.toFixed(0)} s per stop. Counts tyre time and stops only: no traffic, safety cars or weather.
        {" "}
        {laps < full
          ? `The stop counts below are for the full ${full} laps, so they are left out of a ${laps}-lap race`
          : `${stopShare("1")}% of simulated races here were one-stoppers${stopShare("2") ? `, ${stopShare("2")}% two` : ""}`}
        {scChance == null ? "" : `. About ${scChance}% chance of a safety car over the distance, which makes an early stop cheap`}.
      </p>
      <ol className="plans">
        {ranked.map((c) => {
          const p = plans[c]!;
          return (
            <li key={c}>
              <span className="plan-start"><Tyre compound={c} /> {c.toLowerCase()}</span>
              <span>
                {p.stints.map((s, i) => (
                  <span key={i}>{i > 0 && " → "}<Tyre compound={s.compound} /> {s.laps}</span>
                ))}
              </span>
              <span className="muted">{p.delta < 0.05 ? "fastest" : `+${p.delta.toFixed(1)} s`}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
