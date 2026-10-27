import { useMemo, useState } from "react";
import { cleanLaps, fuelCorrected, niceTicks, stintSlope, stintsOf, wearPrior } from "../../strategy/analysis";
import type { Slope } from "../../strategy/analysis";
import type { LapRow, TyreGuide } from "../../types";

export interface Series {
  id: string;
  label: string;
  colour: string; // a CSS variable, from the validated categorical palette
  rows: LapRow[];
  own?: boolean; // one of the player's cars: drawn heavier, with the team colour on its key
}

const W = 960, H = 318, L = 62, R = 74, T = 14, B = 34;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** The band the stint's wear may lie in: the fitted line, and the same line tilted by one standard deviation of the slope about the
 * stint's middle. It is wide on the pre-race estimate and closes in as clean laps arrive. */
function band(sl: Slope, clean: LapRow[], end: LapRow, x: (lap: number) => number, y: (t: number) => number): string {
  const a0 = clean[0], a1 = end;
  const mid = clean.reduce((s, r) => s + r[3], 0) / clean.length;
  const at = (age: number, tilt: number) => sl.intercept + sl.perLap * age + tilt * sl.sd * (age - mid);
  const pts = [[a0[0], a0[3], 1], [a1[0], a1[3], 1], [a1[0], a1[3], -1], [a0[0], a0[3], -1]] as const;
  return pts.map(([lap, age, tilt], i) => `${i ? "L" : "M"}${x(lap).toFixed(1)} ${y(at(age, tilt)).toFixed(1)}`).join("") + "Z";
}

/** Lap times against lap number for the chosen cars. Pit and safety-car laps are left out (the stop is a tick on the axis, neutralised
 * laps are a shaded band), and each stint's wear is a dashed line fitted through its clean laps. */
export function LapChart({ series, fuel, corrected, laps, guide, markLap = null }: { series: Series[]; fuel: number; corrected: boolean; laps: number; guide?: TyreGuide; markLap?: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => {
    return series.map((s) => {
      const clean = cleanLaps(s.rows).map((r) => ({ lap: r[0], t: corrected ? fuelCorrected(r[1], r[0], fuel) : r[1], age: r[3], compound: r[2] }));
      const fits = stintsOf(s.rows).map((st) => ({ slope: stintSlope(st.clean, fuel, corrected, wearPrior(guide, st.compound)), clean: st.clean, end: st.laps[st.laps.length - 1] }));
      return { ...s, clean, fits, stops: s.rows.filter((r) => r[4].includes("P")).map((r) => r[0]), neutral: s.rows.filter((r) => /[SVR]/.test(r[4])).map((r) => r[0]) };
    });
  }, [series, fuel, corrected, guide]);
  const all = data.flatMap((d) => d.clean.map((p) => p.t));
  if (!all.length) return <div className="chart-empty">Lap times appear here after the first racing laps.</div>;
  const xMax = Math.max(laps, 8);
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.12, 0.3);
  const y0 = lo - pad, y1 = hi + pad;
  const x = (lap: number) => L + ((lap - 1) / Math.max(xMax - 1, 1)) * (W - L - R);
  const y = (t: number) => T + (1 - (t - y0) / (y1 - y0)) * (H - T - B);
  const yTicks = niceTicks(y0, y1);
  const xTicks = Array.from({ length: Math.floor((xMax - 1) / 5) + 1 }, (_, i) => 1 + i * 5);
  const neutral = [...new Set(data.flatMap((d) => d.neutral))];
  const tip = hover === null ? [] : data.map((d) => ({ d, p: d.clean.find((p) => p.lap === hover) })).filter((x) => x.p);

  return (
    <div className="chart" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lap times of the chosen cars"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          setHover(Math.min(Math.max(Math.round(1 + ((px - L) / (W - L - R)) * (xMax - 1)), 1), xMax));
        }}>
        {neutral.map((lap) => <rect key={lap} x={x(lap) - (W - L - R) / (xMax - 1) / 2} y={T} width={(W - L - R) / (xMax - 1)} height={H - T - B} className="chart-neutral" />)}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={L - 8} y={y(t) + 5} textAnchor="end" className="chart-axis">{fmt(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className="chart-axis">{t}</text>)}
        {data.map((d) => (
          <g key={d.id} className={d.own ? "own" : undefined} style={{ ["--c" as string]: d.colour }}>
            {d.fits.map((f, i) => f.slope && f.clean.length ? (
              <path key={`b${i}`} className="chart-band" d={band(f.slope, f.clean, f.end, x, y)} />
            ) : null)}
            {d.fits.map((f, i) => f.slope && f.clean.length ? (
              <line key={i} className="chart-fit" x1={x(f.clean[0][0])} x2={x(f.end[0])}
                y1={y(f.slope.intercept + f.slope.perLap * f.clean[0][3])} y2={y(f.slope.intercept + f.slope.perLap * f.end[3])} />
            ) : null)}
            <path className="chart-line" d={d.clean.map((p, i) => `${i && d.clean[i - 1].lap === p.lap - 1 ? "L" : "M"}${x(p.lap).toFixed(1)} ${y(p.t).toFixed(1)}`).join("")} />
            {d.clean.map((p) => <circle key={p.lap} cx={x(p.lap)} cy={y(p.t)} r={3.5} className="chart-dot" />)}
            {d.stops.map((lap) => <path key={lap} d={`M${x(lap) - 5} ${H - B - 1}l5 -9l5 9z`} className="chart-stop" />)}
            {d.clean.length > 0 && (
              <g>
                <rect x={W - R + 6} y={y(d.clean[d.clean.length - 1].t) - 7} width={10} height={10} rx={2} className="chart-key" />
                <text x={W - R + 22} y={y(d.clean[d.clean.length - 1].t) + 4} className="chart-label">{d.label}</text>
              </g>
            )}
          </g>
        ))}
        {markLap !== null && markLap >= 1 && markLap <= xMax && (
          <g>
            <line x1={x(markLap)} x2={x(markLap)} y1={T} y2={H - B} className="chart-mark" />
            <text x={x(markLap) + 4} y={T + 12} className="chart-label">Decision, lap {markLap}</text>
          </g>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="chart-cross" />}
      </svg>
      <p className="chart-caption">Lap time against lap{corrected ? `, corrected to a full tank (adds back ${fuel.toFixed(3)} s for every lap of fuel burnt)` : ""}. Dashed: wear of each stint, from the tyre guide at first and then from its own laps; the shaded band is its uncertainty. ▲ pit stop. Shaded: safety car.</p>
      {hover !== null && tip.length > 0 && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>Lap {hover}</strong>
          {tip.map(({ d, p }) => (
            <div key={d.id}><span className="swatch" style={{ background: d.colour }} /> {d.label} <b>{fmt(p!.t)}</b> <span className="muted">{p!.compound.toLowerCase()}, {p!.age === 1 ? "1 lap" : `${p!.age} laps`} old</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
