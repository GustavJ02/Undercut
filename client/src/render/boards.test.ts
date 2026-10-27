import { describe, expect, it } from "vitest";
import { blueFlags } from "./model";
import { baseCars, play } from "./testkit";
import { synth } from "./synth";
import { boardState } from "../scene/fx/state";

const view = (cars: { id: string; lap: number; lap_frac: number; status?: string }[], session = "RACING") =>
  ({ session, cars: cars.map((c) => ({ status: "RUNNING", ...c })) }) as never;

describe("blue flags", () => {
  it("flag a car about to be lapped on the main straight", () => {
    const v = view([{ id: "A", lap: 6, lap_frac: 0.97 }, { id: "B", lap: 5, lap_frac: 0.99 }]); // A is 0.02 lap behind B's position, a lap up
    expect(blueFlags(v)).toEqual([{ lapped: "B", by: "A" }]);
  });
  it("do not flag a car that is not about to be lapped, is far from the straight, or is in the pits", () => {
    expect(blueFlags(view([{ id: "A", lap: 6, lap_frac: 0.5 }, { id: "B", lap: 5, lap_frac: 0.9 }]))).toEqual([]); // A is half a lap off
    expect(blueFlags(view([{ id: "A", lap: 6, lap_frac: 0.4 }, { id: "B", lap: 5, lap_frac: 0.42 }]))).toEqual([]); // mid-lap, not on the straight
    expect(blueFlags(view([{ id: "A", lap: 6, lap_frac: 0.97 }, { id: "B", lap: 5, lap_frac: 0.99, status: "IN_PIT" }]))).toEqual([]);
    expect(blueFlags(view([{ id: "A", lap: 6, lap_frac: 0.97 }, { id: "B", lap: 6, lap_frac: 0.99 }]))).toEqual([]); // same lap: a normal pass
  });
  it("show nothing behind the safety car, and not in the first laps", () => {
    expect(blueFlags(view([{ id: "A", lap: 6, lap_frac: 0.97 }, { id: "B", lap: 5, lap_frac: 0.99 }], "SC"))).toEqual([]);
    expect(blueFlags(view([{ id: "A", lap: 1, lap_frac: 0.97 }, { id: "B", lap: 0, lap_frac: 0.99 }]))).toEqual([]);
  });
  it("appear in a synthetic race where one car is much slower", () => {
    const { models } = play(synth({ seed: 3, carIds: baseCars(), laps: 12, lapS: 60, slow: baseCars()[5].id }));
    expect(models.some((m) => m.blue.some((b) => b.lapped === baseCars()[5].id))).toBe(true);
  });
});

describe("the end of a safety car", () => {
  it("is announced once and held until the period ends", () => {
    const { models } = play(synth({ seed: 3, carIds: baseCars(), laps: 12, lapS: 60, safetyCar: [60, 200] }));
    const sc = models.filter((m) => m.session === "SC");
    expect(sc.some((m) => !m.safetyEnding) && sc.some((m) => m.safetyEnding)).toBe(true);
    expect(sc.findIndex((m) => m.safetyEnding)).toBeGreaterThan(0);
    expect(models.filter((m) => m.session !== "SC").every((m) => !m.safetyEnding)).toBe(true);
    const first = sc.findIndex((m) => m.safetyEnding);
    expect(sc.slice(first).every((m) => m.safetyEnding)).toBe(true);
  });
});

describe("the LED boards", () => {
  const base = { safetyEnding: false, blueNum: null, now: 0, reduced: true };
  it("show blue only under green and the safety car's state otherwise", () => {
    expect(boardState({ ...base, lighting: "green", blueNum: 12 })?.lines).toEqual(["BLUE", "#12"]);
    expect(boardState({ ...base, lighting: "sc", blueNum: 12 })?.lines).toEqual(["SC"]);
    expect(boardState({ ...base, lighting: "sc", safetyEnding: true })?.lines).toEqual(["SC", "IN THIS LAP"]);
    expect(boardState({ ...base, lighting: "vsc" })?.lines).toEqual(["VSC"]);
    expect(boardState({ ...base, lighting: "vsc", safetyEnding: true })?.lines).toEqual(["VSC", "ENDING"]);
    expect(boardState({ ...base, lighting: "green" })).toBeNull();
  });
  it("flash, unless motion is reduced", () => {
    const on = (now: number) => boardState({ ...base, lighting: "sc", reduced: false, now })!.lit;
    expect(new Set([0, 0.2, 0.4, 0.6, 0.8].map(on)).size).toBe(2);
    expect(boardState({ ...base, lighting: "sc", now: 0.4 })!.lit).toBe(true);
  });
});

describe("the safety car on the track", () => {
  it("is in the model while the server publishes it and null otherwise, with a speed from successive states", () => {
    const { models } = play(synth({ seed: 3, carIds: baseCars(), laps: 12, lapS: 60, safetyCar: [60, 200] }));
    const on = models.filter((m) => m.safetyCar);
    expect(on.length).toBeGreaterThan(5);
    expect(models.filter((m) => m.session !== "SC").every((m) => m.safetyCar === null)).toBe(true);
    expect(on.some((m) => m.safetyCar!.speed > 0)).toBe(true);
  });
});
