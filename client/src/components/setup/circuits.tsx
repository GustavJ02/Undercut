import type { ReactNode } from "react";
import { CIRCUIT_ENTRIES } from "../../circuits";
import { outlineFor } from "../../scene/path";
import { finishLine, outlinePath } from "../../track";

export interface CircuitMeta {
  country: string;
  place: string;
  flag: ReactNode;
}

const Flag = ({ children }: { children: ReactNode }) => (
  <svg className="flag" viewBox="0 0 30 20" role="img" aria-hidden="true">
    <clipPath id="flag-clip"><rect width="30" height="20" rx="2" /></clipPath>
    <g clipPath="url(#flag-clip)">{children}</g>
    <rect width="30" height="20" rx="2" fill="none" stroke="rgba(255,255,255,0.25)" />
  </svg>
);

const stripes = (cols: string[], vertical = false) => cols.map((c, i) => vertical ? <rect key={i} x={(30 / cols.length) * i} width={30 / cols.length + 0.1} height="20" fill={c} /> : <rect key={i} y={(20 / cols.length) * i} width="30" height={20 / cols.length + 0.1} fill={c} />);
const star = (cx: number, cy: number, r: number, fill = "#fff") => <polygon key={`${cx}${cy}${r}`} fill={fill} points={Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.4 : r; return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`; }).join(" ")} />;
const zigzag = (x: number, n: number, depth: number, fill: string) => <polygon fill={fill} points={`0,0 ${x},0 ${Array.from({ length: n }, (_, i) => `${x + (i % 2 ? 0 : depth)},${(20 / n) * (i + 0.5)}`).join(" ")} ${x},20 0,20`} />;

const FLAGS: Record<string, ReactNode> = {
  AT: <>{stripes(["#ed2939", "#fff", "#ed2939"])}</>,
  AZ: <>{stripes(["#00b5e2", "#ef3340", "#509e2f"])}<circle cx="13.5" cy="10" r="3" fill="#fff" /><circle cx="14.4" cy="10" r="2.5" fill="#ef3340" /><circle cx="17.6" cy="10" r="0.9" fill="#fff" /></>,
  US: <><rect width="30" height="20" fill="#fff" />{[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} y={i * 2.86} width="30" height="1.43" fill="#b22234" />)}<rect width="13" height="10.8" fill="#3c3b6e" />{[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => <circle key={`${r}${c}`} cx={1.6 + c * 2.4 + (r % 2) * 1.2} cy={1.6 + r * 2.4} r="0.5" fill="#fff" />))}</>,
  AE: <>{stripes(["#00732f", "#fff", "#000"])}<rect width="7.5" height="20" fill="#ff0000" /></>,
  AU: <><rect width="30" height="20" fill="#00247d" /><rect width="15" height="10" fill="#012169" /><path d="M0 0L15 10M15 0L0 10" stroke="#fff" strokeWidth="2" /><path d="M7.5 0V10M0 5H15" stroke="#fff" strokeWidth="3.4" /><path d="M7.5 0V10M0 5H15" stroke="#cf142b" strokeWidth="1.8" />{star(7.5, 15.5, 2.6)}{star(22, 4.5, 1.4)}{star(25.5, 9, 1.4)}{star(22, 15, 1.4)}{star(18.5, 9, 1.4)}</>,
  BH: <><rect width="30" height="20" fill="#ce1126" />{zigzag(8, 10, 3, "#fff")}</>,
  ES: <><rect width="30" height="20" fill="#aa151b" /><rect y="5" width="30" height="10" fill="#f1bf00" /></>,
  BE: <>{stripes(["#000", "#fae042", "#ed2939"], true)}</>,
  GB: <><rect width="30" height="20" fill="#012169" /><path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" /><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.6" /><path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6.5" /><path d="M15 0V20M0 10H30" stroke="#c8102e" strokeWidth="3.6" /></>,
  CA: <><rect width="30" height="20" fill="#fff" /><rect width="7.5" height="20" fill="#d52b1e" /><rect x="22.5" width="7.5" height="20" fill="#d52b1e" /><polygon fill="#d52b1e" points="15,4 16.4,7.6 19.6,6.8 18,10.2 20.6,11.6 16.8,12.4 16.8,16 13.2,16 13.2,12.4 9.4,11.6 12,10.2 10.4,6.8 13.6,7.6" /></>,
  CN: <><rect width="30" height="20" fill="#de2910" />{star(5, 5, 3, "#ffde00")}{star(10, 2.2, 1, "#ffde00")}{star(12, 4.6, 1, "#ffde00")}{star(12, 7.4, 1, "#ffde00")}{star(10, 9.6, 1, "#ffde00")}</>,
  NL: <>{stripes(["#ae1c28", "#fff", "#21468b"])}</>,
  HU: <>{stripes(["#ce2939", "#fff", "#477050"])}</>,
  IT: <>{stripes(["#009246", "#fff", "#ce2b37"], true)}</>,
  JP: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="6" fill="#bc002d" /></>,
  MX: <>{stripes(["#006847", "#fff", "#ce1126"], true)}<circle cx="15" cy="10" r="2.6" fill="#8a6a3b" /></>,
  MC: <>{stripes(["#ce1126", "#fff"])}</>,
  QA: <><rect width="30" height="20" fill="#8a1538" />{zigzag(9, 9, 3.5, "#fff")}</>,
  BR: <><rect width="30" height="20" fill="#009c3b" /><polygon points="15,2 28,10 15,18 2,10" fill="#ffdf00" /><circle cx="15" cy="10" r="4.4" fill="#002776" /><path d="M10.8 9.2Q15 7.6 19.2 10.6" stroke="#fff" strokeWidth="0.8" fill="none" /></>,
  SG: <>{stripes(["#ed2939", "#fff"])}<circle cx="6" cy="5" r="3" fill="#fff" /><circle cx="7" cy="5" r="2.6" fill="#ed2939" />{[0, 1, 2, 3, 4].map((i) => <circle key={i} cx={11 + (i % 3) * 1.8 - (i > 2 ? 0.9 : 0)} cy={3.2 + Math.floor(i / 3) * 3.4 + 1} r="0.55" fill="#fff" />)}</>,
};

export const CIRCUITS: Record<string, CircuitMeta> = Object.fromEntries(
  Object.entries(CIRCUIT_ENTRIES).map(([id, c]) => [id, { country: c.country, place: c.place, flag: <Flag>{FLAGS[c.flag]}</Flag> }]),
);

const GENERIC: CircuitMeta = {
  country: "",
  place: "",
  flag: (<Flag><rect width="30" height="20" fill="#fff" />{[0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2].map((j) => ((i + j) % 2 ? <rect key={`${i}${j}`} x={i * 5} y={j * 6.67} width="5" height="6.67" fill="#111" /> : null)))}</Flag>),
};

export const circuitMeta = (id: string): CircuitMeta => CIRCUITS[id] ?? { ...GENERIC, place: id.replace(/_/g, " ") };
export const circuitName = (id: string) => CIRCUIT_ENTRIES[id]?.name ?? id.replace(/_/g, " ");

/** Circuit ids in alphabetical order of their names. */
export const byName = (ids: string[]): string[] => [...ids].sort((a, b) => circuitName(a).localeCompare(circuitName(b)));

/** The circuit's outline with the start line, drawn from the same data as the track map. */
export function TrackPicture({ circuit }: { circuit: string }) {
  const o = outlineFor(circuit);
  const f = finishLine(o);
  return (
    <svg className="track-picture" viewBox={`0 0 ${o.width} ${o.height}`} role="img" aria-label={`Outline of ${circuitName(circuit)}`}>
      <path d={outlinePath(o)} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="15" strokeLinejoin="round" />
      <path d={outlinePath(o)} fill="none" stroke="#9aa3b5" strokeWidth="9" strokeLinejoin="round" />
      <path d={outlinePath(o)} fill="none" stroke="#2a303c" strokeWidth="6" strokeLinejoin="round" />
      <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke="#fff" strokeWidth="3" strokeDasharray="3 3" />
    </svg>
  );
}

/** The numbers of a circuit, the same on the circuit page and before the start: laps, lap length, distance, corners and the safety car chance. */
export function CircuitStats({ laps, lapLengthM, corners, scRate }: { laps: number; lapLengthM?: number; corners?: number; scRate?: number }) {
  const km = lapLengthM == null ? null : (lapLengthM * laps) / 1000;
  const scChance = scRate == null ? null : 1 - Math.exp(-scRate * laps);
  return (
    <dl className="stats">
      <div><dt>Laps</dt><dd>{laps}</dd></div>
      {lapLengthM != null && <div><dt>Lap length</dt><dd>{(lapLengthM / 1000).toFixed(3)} km</dd></div>}
      {km != null && <div><dt>Race distance</dt><dd>{km.toFixed(0)} km</dd></div>}
      {corners != null && <div><dt>Corners</dt><dd>{corners}</dd></div>}
      {scChance != null && <div><dt>Safety car, per race</dt><dd>about {Math.round(scChance * 100)}%</dd></div>}
    </dl>
  );
}
