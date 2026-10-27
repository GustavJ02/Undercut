// A circuit outline as a closed polyline, and the lap fraction -> point mapping along it by arc length. Pure, so it is tested
// without a DOM. Points start at the start/finish line and run in driving direction; the loop closes implicitly.

export type Pt = { x: number; y: number };

export type Outline = {
  pts: Pt[];
  cum: number[]; // cum[i] = arc length from pts[0] to pts[i]; cum[n] = full loop length
  width: number;
  height: number;
};

// Scale a unit-box outline so its longer side is `size`, with `pad` of margin around it.
export function buildOutline(unit: number[][], size = 300, pad = 18): Outline {
  const pts = unit.map(([x, y]) => ({ x: pad + x * size, y: pad + y * size }));
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const w = Math.max(...unit.map((p) => p[0]));
  const h = Math.max(...unit.map((p) => p[1]));
  return { pts, cum, width: w * size + 2 * pad, height: h * size + 2 * pad };
}

export function outlinePoint(o: Outline, frac: number): Pt {
  return at(o, frac).p;
}

function at(o: Outline, frac: number): { p: Pt; dir: Pt } {
  const n = o.pts.length;
  const f = ((frac % 1) + 1) % 1;
  const d = f * o.cum[n];
  // Binary search for the segment holding distance d.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (o.cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = o.pts[lo];
  const b = o.pts[(lo + 1) % n];
  const span = o.cum[lo + 1] - o.cum[lo];
  const t = span > 0 ? (d - o.cum[lo]) / span : 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { p: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

export function outlinePath(o: Outline): string {
  return o.pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";
}

// The start/finish line: a short segment across the track at lap fraction 0.
export function finishLine(o: Outline, half = 9): { x1: number; y1: number; x2: number; y2: number } {
  const { p, dir } = at(o, 0);
  return { x1: p.x - dir.y * half, y1: p.y + dir.x * half, x2: p.x + dir.y * half, y2: p.y - dir.x * half };
}
