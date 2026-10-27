/** Placing cars on a circuit outline without allocating: `sampleOutline` writes the point and heading for a lap fraction into a
 * caller-owned object, so the 60 fps loop creates no garbage. The outline is the one the track map uses (`track.ts`). */
import { buildOutline, type Outline } from "../track";
import { TRACKS } from "../circuits";

export interface Placed {
  x: number;
  y: number;
  heading: number; // radians, direction of travel
}

export function sampleOutline(o: Outline, frac: number, out: Placed): Placed {
  const n = o.pts.length;
  const f = ((frac % 1) + 1) % 1;
  const d = f * o.cum[n];
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
  out.x = a.x + t * (b.x - a.x);
  out.y = a.y + t * (b.y - a.y);
  out.heading = Math.atan2(b.y - a.y, b.x - a.x);
  return out;
}

/** The circuit's real outline when we have one, else a schematic oval of the same size. */
export function outlineFor(circuit: string): Outline {
  const unit = TRACKS[circuit] ?? Array.from({ length: 120 }, (_, i) => {
    const a = (i / 120) * 2 * Math.PI - Math.PI / 2;
    return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.28 * Math.sin(a)];
  });
  return buildOutline(unit);
}
