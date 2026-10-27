/** The arithmetic behind the strategy screen, from public lap times and the team's own telemetry. Pure functions, so they are tested as
 * numbers. Everything here is an estimate from noisy data and is labelled so in the UI. */
import type { LapRow, RaceInfo, TyreGuide } from "../types";

export const MIN_STINT_LAPS = 4;

export interface CleanLap {
  lap: number;
  time: number; // seconds, fuel corrected when asked for
  age: number;
  compound: string;
}

/** Laps that say something about the car and the tyres: not lap 1 (the standing start), not a lap with a stop, the lap after a stop (the
 * pit lane straddles the line, so the loss is split over two laps), and not under a safety car, VSC or red flag. */
export function cleanLaps(rows: LapRow[]): LapRow[] {
  const out: LapRow[] = [];
  let afterStop = false;
  for (const r of [...rows].sort((a, b) => a[0] - b[0])) {
    const stop = r[4].includes("P");
    const neutral = /[SVR]/.test(r[4]);
    if (r[0] > 1 && !stop && !neutral && !afterStop) out.push(r);
    afterStop = stop;
  }
  return out;
}

/** The lap time as if the tank were as full as on lap 1: `t + fuel * (lap - 1)`. Burning fuel makes the car faster every lap, which hides
 * the tyres wearing; adding it back leaves the tyres. */
export const fuelCorrected = (time: number, lap: number, fuelPerLap: number): number => time + fuelPerLap * (lap - 1);

export interface Stint {
  index: number; // 1-based
  compound: string;
  laps: LapRow[]; // every lap of the stint, clean or not
  clean: LapRow[];
}

/** Split a car's laps into stints: a new one starts after a lap with a stop, or when the tyre age drops. */
export function stintsOf(rows: LapRow[]): Stint[] {
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  const stints: Stint[] = [];
  let cur: LapRow[] = [];
  let prevStop = false;
  let prevAge = -1;
  const flush = () => {
    if (cur.length) stints.push({ index: stints.length + 1, compound: cur[cur.length - 1][2], laps: cur, clean: cleanLaps(cur) });
    cur = [];
  };
  for (const r of sorted) {
    if (cur.length && (prevStop || r[3] < prevAge)) flush();
    cur.push(r);
    prevStop = r[4].includes("P");
    prevAge = r[3];
  }
  flush();
  return stints;
}

export interface Slope {
  perLap: number; // seconds per lap of tyre age (positive: the tyres are costing time)
  intercept: number; // fitted time at age 0
  n: number; // laps used
  /** One standard deviation of `perLap`: wide on the pre-race estimate alone, narrower with every clean lap. */
  sd: number;
  /** The pre-race tyre guide was part of the estimate. */
  prior: boolean;
}

/** What the tyre guide says before the race about how much a lap of age costs on a compound. */
export interface WearPrior {
  perLap: number;
  sd: number;
}

/** How far a stint's wear may sit from the guide's average, one standard deviation, in seconds per lap of age. An assumption: the
 * guide is a fitted average, and single stints differ from it by a few hundredths. */
export const WEAR_PRIOR_SD = 0.03;
/** Scatter of a clean lap time around the stint's line when there are too few laps to measure it. */
const LAP_NOISE_S = 0.3;

export const wearPrior = (guide: TyreGuide | undefined, compound: string): WearPrior | undefined => {
  const c = guide?.compounds[compound as keyof TyreGuide["compounds"]];
  return c ? { perLap: c.wear_s_per_lap, sd: WEAR_PRIOR_SD } : undefined;
};

/** Laps more than `OUTLIER_S` slower than the stint's median are not wear (a restart, a slow car in the way, an unflagged mistake). */
const OUTLIER_S = 4;
function withoutOutliers(rows: LapRow[], fuelPerLap: number, corrected: boolean): LapRow[] {
  if (rows.length < 3) return rows;
  const t = (r: LapRow) => (corrected ? fuelCorrected(r[1], r[0], fuelPerLap) : r[1]);
  const sorted = rows.map(t).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return rows.filter((r) => t(r) - median <= OUTLIER_S);
}

/** Wear of the stint: the least-squares line of lap time against tyre age over its clean laps, combined with the pre-race estimate
 * when there is one (a normal prior times the line's own uncertainty). With the prior it answers from the first clean lap and the
 * answer moves from the guide towards the data as laps come in; without it, null until `MIN_STINT_LAPS` clean laps. */
export function stintSlope(all: LapRow[], fuelPerLap: number, corrected = true, prior?: WearPrior): Slope | null {
  const clean = withoutOutliers(all, fuelPerLap, corrected);
  const n = clean.length;
  if (!prior && n < MIN_STINT_LAPS) return null;
  const xs = clean.map((r) => r[3]);
  const ys = clean.map((r) => (corrected ? fuelCorrected(r[1], r[0], fuelPerLap) : r[1]));
  const mx = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
  const my = n ? ys.reduce((a, b) => a + b, 0) / n : 0;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0 && !prior) return null;
  const line = sxx > 0 ? sxy / sxx : null; // the data's own slope, when the laps span more than one age
  let rss = 0;
  if (line !== null) for (let i = 0; i < n; i++) rss += (ys[i] - my - line * (xs[i] - mx)) ** 2;
  const noise = n >= 4 ? Math.max(Math.sqrt(rss / (n - 2)), 0.1) : LAP_NOISE_S;
  const lineSd = line !== null ? noise / Math.sqrt(sxx) : Infinity;
  let perLap: number, sd: number;
  if (prior) {
    const wp = 1 / prior.sd ** 2, wl = line !== null ? 1 / lineSd ** 2 : 0;
    perLap = (wp * prior.perLap + wl * (line ?? 0)) / (wp + wl);
    sd = Math.sqrt(1 / (wp + wl));
  } else {
    perLap = line!;
    sd = lineSd;
  }
  return { perLap, intercept: my - perLap * mx, n, sd, prior: !!prior };
}

export interface GapCar {
  id: string;
  gap_to_leader_s: number | null;
  status: string;
}

export interface Rejoin {
  /** Position the car would rejoin in, among the cars with a time gap. */
  position: number;
  ahead: string | null;
  behind: string | null;
  /** Seconds behind the car it would rejoin behind, and ahead of the next one; null when there is none. */
  behindAheadS: number | null;
  aheadOfBehindS: number | null;
  /** Rejoining within the traffic window of the car in front: its dirty air would cost pace. */
  inTraffic: boolean;
}

/** What a stop costs now: the green-flag loss, or the smaller one under a safety car or a VSC. Undefined when the server did not send it. */
export function pitLossNow(info: Partial<Pick<RaceInfo, "pit_loss_s" | "pit_loss_sc_s" | "pit_loss_vsc_s">>, session: string): number | undefined {
  if (session === "SC") return info.pit_loss_sc_s ?? info.pit_loss_s;
  if (session === "VSC") return info.pit_loss_vsc_s ?? info.pit_loss_s;
  return info.pit_loss_s;
}

/** Where a car would come out after a stop at the green-flag pit loss, from the gaps to the leader. Null when the car has no time gap. */
export function rejoinAfterStop(cars: GapCar[], id: string, pitLoss: number, window: number): Rejoin | null {
  const me = cars.find((c) => c.id === id);
  if (!me || me.gap_to_leader_s === null) return null;
  const arrive = me.gap_to_leader_s + pitLoss;
  const others = cars
    .filter((c) => c.id !== id && c.gap_to_leader_s !== null && (c.status === "RUNNING" || c.status === "IN_PIT"))
    .sort((a, b) => (a.gap_to_leader_s as number) - (b.gap_to_leader_s as number));
  const ahead = others.filter((c) => (c.gap_to_leader_s as number) <= arrive);
  const behind = others.filter((c) => (c.gap_to_leader_s as number) > arrive);
  const a = ahead[ahead.length - 1] ?? null;
  const b = behind[0] ?? null;
  const behindAheadS = a ? arrive - (a.gap_to_leader_s as number) : null;
  return {
    position: ahead.length + 1,
    ahead: a?.id ?? null,
    behind: b?.id ?? null,
    behindAheadS,
    aheadOfBehindS: b ? (b.gap_to_leader_s as number) - arrive : null,
    inTraffic: behindAheadS !== null && behindAheadS < window,
  };
}

/** What an out lap on fresh tyres costs against a settled lap, seconds: an assumption, shown as one. */
export const OUT_LAP_PENALTY_S = 0.4;

export interface Undercut {
  /** Laps the rival needs to stay out for the stop to pay, or null when it does not within `maxLaps`. */
  laps: number | null;
  /** Seconds gained per lap while the rival is on its old tyres. */
  gainPerLap: number;
  /** After `maxLaps` laps, seconds ahead (positive) or behind the gap that has to be closed. */
  marginAtMax: number;
}

/** The undercut: stop now, the rival stops `k` laps later, and in between the fresh tyres gain `rivalLoss` per lap (what the rival's old
 * tyres cost against fresh ones). It works once the total gain covers the gap, `interval`, to the car in front, after paying the out lap. */
export function undercut(interval: number, rivalLoss: number, maxLaps = 3): Undercut {
  for (let k = 1; k <= maxLaps; k++) if (k * rivalLoss - OUT_LAP_PENALTY_S >= interval) return { laps: k, gainPerLap: rivalLoss, marginAtMax: maxLaps * rivalLoss - OUT_LAP_PENALTY_S - interval };
  return { laps: null, gainPerLap: rivalLoss, marginAtMax: maxLaps * rivalLoss - OUT_LAP_PENALTY_S - interval };
}

/** What a rival's old tyres cost against fresh ones now: the stint slope times the tyre age; null without a slope. */
export const rivalLoss = (slope: Slope | null, age: number): number | null => (slope ? Math.max(slope.perLap, 0) * age : null);

/** The team's tyre-loss estimate as seconds lost per lap (positive = time lost). It is noisy around a small true value, so a negative
 * reading means "none" and is shown as zero rather than as a gain. */
export const tyreLoss = (estimate: number): number => Math.max(estimate, 0);

/** Whether a pit call made now still counts for this lap, and how many seconds are left to make it (from the last lap time; null
 * without one). After the deadline the call is for the next lap. */
export function callDeadline(lapFrac: number, deadlineFrac: number, lapTimeS: number | null): { open: boolean; seconds: number | null } {
  const left = deadlineFrac - lapFrac;
  return { open: left > 0, seconds: left > 0 && lapTimeS ? left * lapTimeS : null };
}

/** Whether a stop can still be called: the engine refuses one that would take effect on the last two laps (a call after the deadline
 * takes effect on the next lap). `lap` is the laps the car has completed. */
export function stopStillPossible(car: { lap: number; lap_frac: number }, totalLaps: number, deadlineFrac?: number): boolean {
  return car.lap + (deadlineFrac !== undefined && car.lap_frac > deadlineFrac ? 1 : 0) < totalLaps - 1;
}

/** Round tick values between `lo` and `hi`: multiples of 0.1, 0.2, 0.5, 1, 2, 5, 10 ... s, the smallest step that gives about `count` ticks. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / Math.max(count - 1, 1);
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * base).find((s) => s >= raw - 1e-12)!;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t / step) * step);
  return out;
}

/** Cars in a fixed order for the chart's chips, which must not move as the race changes: our cars first, then by team, then by car. */
export function chipOrder<T extends { id: string; team: string }>(cars: T[], mine: string[]): T[] {
  const own = (c: T) => (mine.includes(c.id) ? 0 : 1);
  return [...cars].sort((a, b) => own(a) - own(b) || a.team.localeCompare(b.team) || a.id.localeCompare(b.id));
}
