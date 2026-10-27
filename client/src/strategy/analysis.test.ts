import { describe, expect, it } from "vitest";
import type { LapRow } from "../types";
import { cleanLaps, fuelCorrected, MIN_STINT_LAPS, OUT_LAP_PENALTY_S, rejoinAfterStop, rivalLoss, stintSlope, stintsOf, tyreLoss, undercut, callDeadline, niceTicks, chipOrder, pitLossNow } from "./analysis";

const row = (lap: number, time: number, age: number, flags = "", c = "MEDIUM"): LapRow => [lap, time, c as LapRow[2], age, flags];

describe("clean laps", () => {
  it("drops lap 1, stop laps, the lap after a stop and neutralised laps", () => {
    const rows = [row(1, 90, 1), row(2, 80, 2), row(3, 99, 3, "P"), row(4, 85, 1, "", "HARD"), row(5, 80, 2, "", "HARD"), row(6, 120, 3, "S", "HARD"), row(7, 80, 4, "", "HARD")];
    expect(cleanLaps(rows).map((r) => r[0])).toEqual([2, 5, 7]);
  });
});

describe("fuel", () => {
  it("adds back the time the burning fuel gains, so a constant car reads constant", () => {
    const k = 0.05;
    const times = [1, 2, 3, 4].map((lap) => 80 - k * (lap - 1));
    expect(times.map((t, i) => fuelCorrected(t, i + 1, k))).toEqual([80, 80, 80, 80].map((x) => expect.closeTo(x, 9)));
  });
});

describe("stints and slopes", () => {
  const rows = [
    ...[1, 2, 3, 4, 5, 6].map((l) => row(l, 80 + 0.1 * l, l, l === 6 ? "P" : "")),
    ...[7, 8, 9, 10, 11].map((l, i) => row(l, 78 + 0.2 * (i + 1), i + 1, "", "HARD")),
  ];
  it("splits at a stop and reads the compound of each stint", () => {
    const s = stintsOf(rows);
    expect(s.map((x) => x.compound)).toEqual(["MEDIUM", "HARD"]);
    expect(s[0].laps).toHaveLength(6);
  });
  it("fits seconds lost per lap of tyre age and counts the laps used", () => {
    const s = stintsOf(rows)[1];
    const slope = stintSlope(s.clean, 0, false)!;
    expect(slope.perLap).toBeCloseTo(0.2, 6);
    expect(slope.n).toBe(s.clean.length);
  });
  it("recovers wear under fuel burn once corrected", () => {
    const k = 0.05;
    const r = [2, 3, 4, 5, 6, 7].map((l) => row(l, 80 + 0.08 * l - k * (l - 1), l));
    expect(stintSlope(r, k, true)!.perLap).toBeCloseTo(0.08, 6);
    expect(stintSlope(r, k, false)!.perLap).toBeLessThan(0.08);
  });
  it("says nothing from too few laps", () => {
    expect(stintSlope(rows.slice(0, MIN_STINT_LAPS - 1), 0)).toBeNull();
  });
});

describe("the pit window", () => {
  const cars = [
    { id: "A", gap_to_leader_s: 0, status: "RUNNING" },
    { id: "B", gap_to_leader_s: 5, status: "RUNNING" },
    { id: "C", gap_to_leader_s: 14, status: "RUNNING" },
    { id: "D", gap_to_leader_s: 30, status: "RUNNING" },
    { id: "E", gap_to_leader_s: null, status: "RUNNING" },
  ];
  it("puts the car between the cars its gap plus the pit loss lands it between", () => {
    const r = rejoinAfterStop(cars, "B", 20, 1.2)!; // 25 s: behind C (14), ahead of D (30)
    expect([r.position, r.ahead, r.behind]).toEqual([3, "C", "D"]);
    expect(r.behindAheadS).toBeCloseTo(11);
    expect(r.aheadOfBehindS).toBeCloseTo(5);
    expect(r.inTraffic).toBe(false);
  });
  it("flags a rejoin right behind another car and handles a missing gap", () => {
    expect(rejoinAfterStop(cars, "B", 9.5, 1.2)!.inTraffic).toBe(true); // 14.5 s, 0.5 s behind C
    expect(rejoinAfterStop(cars, "E", 20, 1.2)).toBeNull();
  });
});

describe("the undercut", () => {
  it("needs enough laps of gain to cover the gap after the out lap", () => {
    expect(undercut(1.0, 0.9).laps).toBe(2); // 2 x 0.9 - 0.4 = 1.4
    expect(undercut(0.3, 0.9).laps).toBe(1);
    expect(undercut(3, 0.5).laps).toBeNull();
    expect(undercut(2, 1).marginAtMax).toBeCloseTo(3 * 1 - OUT_LAP_PENALTY_S - 2);
  });
  it("takes the rival's loss from its slope and age", () => {
    expect(rivalLoss({ perLap: 0.05, intercept: 0, n: 8, sd: 0.01, prior: false }, 10)).toBeCloseTo(0.5);
    expect(rivalLoss(null, 10)).toBeNull();
  });
});

describe("tyreLoss", () => {
  it("reads a negative estimate as no loss and keeps a positive one", () => {
    expect(tyreLoss(-0.54)).toBe(0);
    expect(tyreLoss(0.4)).toBe(0.4);
  });
});

describe("callDeadline", () => {
  it("counts the seconds left before the cutoff and closes after it", () => {
    expect(callDeadline(0.5, 0.8, 90)).toEqual({ open: true, seconds: expect.closeTo(27, 5) });
    expect(callDeadline(0.85, 0.8, 90)).toEqual({ open: false, seconds: null });
    expect(callDeadline(0.5, 0.8, null)).toEqual({ open: true, seconds: null });
  });
});

describe("stintSlope with the pre-race estimate", () => {
  const prior = { perLap: 0.08, sd: 0.03 };
  const laps = (slope: number, n: number): LapRow[] => Array.from({ length: n }, (_, i) => row(i + 2, 90 + slope * (i + 1), i + 1));
  it("answers from the guide before any clean lap, and without the guide stays silent", () => {
    const s = stintSlope([], 0, false, prior)!;
    expect(s.perLap).toBe(0.08);
    expect(s.sd).toBeCloseTo(0.03, 6);
    expect(s.n).toBe(0);
    expect(stintSlope(laps(0.2, 3), 0, false)).toBeNull();
  });
  it("moves from the guide towards the data as clean laps come in, and the uncertainty narrows", () => {
    const [a, b, c] = [2, 6, 14].map((n) => stintSlope(laps(0.2, n), 0, false, prior)!);
    expect(a.perLap).toBeGreaterThan(0.08);
    expect(b.perLap).toBeGreaterThan(a.perLap);
    expect(c.perLap).toBeGreaterThan(b.perLap);
    expect(c.perLap).toBeLessThan(0.2);
    expect(a.sd).toBeGreaterThan(b.sd);
    expect(b.sd).toBeGreaterThan(c.sd);
  });
  it("with a single clean lap keeps the guide's slope and puts the line through that lap", () => {
    const s = stintSlope([row(3, 91, 2)], 0, false, prior)!;
    expect(s.perLap).toBe(0.08);
    expect(s.intercept + s.perLap * 2).toBeCloseTo(91, 6);
  });
});

describe("stintSlope and slow laps", () => {
  it("does not let one lap that is far slower than the rest swamp the stint's wear", () => {
    const good: LapRow[] = Array.from({ length: 6 }, (_, i) => row(i + 3, 90 + 0.1 * (i + 1), i + 1));
    const withSlow = [...good, row(9, 135, 7)];
    const a = stintSlope(good, 0, false, { perLap: 0.04, sd: 0.03 })!;
    const b = stintSlope(withSlow, 0, false, { perLap: 0.04, sd: 0.03 })!;
    expect(b.perLap).toBeCloseTo(a.perLap, 6);
    expect(b.n).toBe(6);
  });
});

describe("niceTicks", () => {
  it("gives round values inside the range, with an even step", () => {
    expect(niceTicks(100.8, 103.7)).toEqual([101, 102, 103]);
    const t = niceTicks(100.9, 103.0);
    expect(t.every((x) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9)).toBe(true); // multiples of 0.5
    expect(t[0]).toBeGreaterThanOrEqual(100.9);
    expect(niceTicks(0.31, 0.62).map((x) => +x.toFixed(2))).toEqual([0.4, 0.5, 0.6]);
  });
});

describe("chipOrder", () => {
  it("keeps our cars first and the rest by team, whatever the running order", () => {
    const cars = [{ id: "C", team: "B" }, { id: "A", team: "B" }, { id: "Z", team: "A" }, { id: "M", team: "C" }];
    expect(chipOrder(cars, ["M"]).map((c) => c.id)).toEqual(["M", "Z", "A", "C"]);
    expect(chipOrder([...cars].reverse(), ["M"]).map((c) => c.id)).toEqual(["M", "Z", "A", "C"]);
  });
});

describe("pitLossNow", () => {
  const info = { pit_loss_s: 22, pit_loss_sc_s: 9.9, pit_loss_vsc_s: 14.3 };
  it("is the green loss, or the smaller one under a safety car or a VSC", () => {
    expect(pitLossNow(info, "RACING")).toBe(22);
    expect(pitLossNow(info, "SC")).toBe(9.9);
    expect(pitLossNow(info, "VSC")).toBe(14.3);
    expect(pitLossNow({ pit_loss_s: 22 }, "SC")).toBe(22);
  });
});
