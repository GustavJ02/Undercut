import { describe, expect, it } from "vitest";
import { LANE, LINE_X, OFF_LEFT, OFF_RIGHT, LANE_EXIT, OWN_BOX, PX_PER_LAP, boxX, laneX, lanePhase, trackX } from "../cars/lane";
import { GO_FLASH_S, GREEN_SHOW_S, dropY, flagFor, gantryState, makeDrops, tintFor, trackSheen, wave } from "./state";

describe("track positions", () => {
  it("puts the line at LINE_X and moves left to right with lap fraction", () => {
    expect(trackX(0)).toBe(LINE_X);
    expect(trackX(0.001)).toBeCloseTo(LINE_X + PX_PER_LAP * 0.001);
    expect(trackX(0.999)).toBeCloseTo(LINE_X - PX_PER_LAP * 0.001);
  });
  it("wraps at the line, and a car far from it is off screen", () => {
    expect(trackX(0.9995)).toBeLessThan(LINE_X);
    expect(trackX(0.5)).toBeNull();
    expect(trackX(0.1)).toBeNull();
    expect(trackX(0.9)).toBeNull();
  });
  it("is monotonic across the screen, so a car never jumps backwards", () => {
    let last = -Infinity;
    for (let f = -0.03; f < 0.03; f += 0.0005) {
      const x = trackX((f + 1) % 1);
      if (x !== null) {
        expect(x).toBeGreaterThan(last);
        last = x;
      }
    }
  });
  it("has a bounded window of about 2.8 s at a 90 s lap", () => {
    const span = (OFF_RIGHT - OFF_LEFT) / PX_PER_LAP;
    expect(span * 90).toBeGreaterThan(2);
    expect(span * 90).toBeLessThan(5); // 3700 px to the right: the track goes on past the strategy screen
  });
});

describe("pit lane", () => {
  const box = 1400;
  it("rolls in from the left, stops at the box, leaves to the right, and is gone after the total time", () => {
    expect(laneX(0, box)).toBe(OFF_LEFT);
    expect(laneX(LANE.enter, box)).toBeCloseTo(box);
    expect(laneX(LANE.enter + LANE.stopped / 2, box)).toBe(box);
    expect(laneX(LANE.total, box)).toBeCloseTo(LANE_EXIT);
    expect(laneX(999, box)).toBeCloseTo(LANE_EXIT);
  });
  it("never goes backwards, and decelerates into the box", () => {
    let last = -Infinity;
    for (let e = 0; e <= 25; e += 0.1) {
      const x = laneX(e, box);
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
    expect(laneX(7, box) - laneX(6, box)).toBeLessThan(laneX(1, box) - laneX(0, box));
  });
  it("reports the phase of the stop", () => {
    expect([0, 7.9, 8, 11.4, 11.5, 18.9, 19].map(lanePhase)).toEqual(["entering", "entering", "stopped", "stopped", "leaving", "leaving", "gone"]);
  });
  it("gives the player's garage the middle of their crew, and rivals boxes clear of it, always the same ones", () => {
    expect(boxX("VMR", "VMR")).toBe(OWN_BOX);
    for (const t of ["OHB", "TLN", "OQY", "CSF", "ITW", "UNG", "SIB", "CVS", "MHL", "GLM"]) {
      const b = boxX(t, "VMR");
      expect(b).toBe(boxX(t, "VMR"));
      expect(b < 1180 || b > 1620).toBe(true);
    }
  });
});

describe("gantry lights", () => {
  const base = { session: "RACING", lighting: "green" as const, now: 100, greenAt: null, lightsOutAt: null };
  const lit = (g: ReturnType<typeof gantryState>) => g.lit.every(Boolean);
  it("is red on the grid and under a red flag, and dark in normal racing", () => {
    expect(gantryState({ ...base, session: "GRID" })).toEqual({ colour: "red", lit: [false, false, false, false, false] });
    expect(gantryState({ ...base, session: "GRID", startLit: 3 })).toEqual({ colour: "red", lit: [true, true, true, false, false] });
    expect(gantryState({ ...base, lighting: "red" }).colour).toBe("red");
    expect(gantryState(base).colour).toBe("off");
    expect(gantryState(base).lit.some(Boolean)).toBe(false);
  });
  it("flashes amber under the safety car and the VSC", () => {
    const on = new Set<boolean>();
    for (let t = 0; t < 2; t += 0.1) on.add(lit(gantryState({ ...base, lighting: "sc", now: t })));
    expect(on).toEqual(new Set([true, false]));
    expect(gantryState({ ...base, lighting: "vsc" }).colour).toBe("amber");
  });
  it("shows green for a few seconds after a restart, then goes dark", () => {
    expect(gantryState({ ...base, greenAt: 98 }).colour).toBe("green");
    expect(gantryState({ ...base, greenAt: 100 - GREEN_SHOW_S - 0.1 }).colour).toBe("off");
  });
  it("flashes at lights out and then is dark", () => {
    expect(gantryState({ ...base, lightsOutAt: 99.9 }).colour).toBe("green");
    expect(gantryState({ ...base, lightsOutAt: 100 - GO_FLASH_S - 0.1 }).colour).toBe("off");
  });
});

describe("flags, tint, rain", () => {
  it("maps lighting to flags", () => {
    expect(["green", "yellow", "sc", "vsc", "red", "chequered"].map((l) => flagFor(l as never))).toEqual(["none", "yellow", "yellow", "yellow", "red", "chequered"]);
  });
  it("waves within its amplitude", () => {
    for (let t = 0; t < 10; t += 0.05) expect(Math.abs(wave(3, t, 4))).toBeLessThanOrEqual(4);
  });
  it("tints for flags and rain, and not for a dry green race; the sheen follows the track", () => {
    expect(tintFor("green", false).alpha).toBe(0);
    expect(tintFor("red", false).alpha).toBeGreaterThan(tintFor("sc", false).alpha);
    expect(tintFor("green", true).alpha).toBeGreaterThan(0);
    expect([trackSheen("dry"), trackSheen("damp"), trackSheen("wet")]).toEqual([0, 0.22, 0.5]);
  });
  it("makes the same raindrops every time, inside the box, and wraps them", () => {
    const a = makeDrops(100, 1920, 420), b = makeDrops(100, 1920, 420);
    expect(a).toEqual(b);
    for (const d of a) {
      expect(d.x >= 0 && d.x < 1920 && d.y >= 0 && d.y < 420).toBe(true);
      for (const t of [0, 1.7, 33]) expect(dropY(d, t, 420)).toBeLessThan(420);
    }
  });
});
