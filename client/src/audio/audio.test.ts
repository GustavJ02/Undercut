import { describe, expect, it } from "vitest";
import { BUSES, DEFAULT_AUDIO, busGain, sanitizeAudio } from "./mixer";
import { PASS_MAX_S, PASS_MIN_S, PassGate, dopplerAt, gunTimes, nextClankDelay, passVoice, swellAt } from "./voices";

describe("mixer", () => {
  it("is the master times the category, and nothing when muted", () => {
    const s = { ...DEFAULT_AUDIO, master: 0.5, engines: 0.8 };
    expect(busGain(s, "engines")).toBeCloseTo(0.4);
    expect(busGain({ ...s, muted: true }, "engines")).toBe(0);
    for (const b of BUSES) expect(busGain({ ...DEFAULT_AUDIO, master: 0 }, b)).toBe(0);
  });
  it("makes valid settings out of anything", () => {
    expect(sanitizeAudio(undefined)).toEqual(DEFAULT_AUDIO);
    expect(sanitizeAudio("loud")).toEqual(DEFAULT_AUDIO);
    expect(sanitizeAudio({ master: 3, engines: -1, ambience: "x", radio: NaN, gun: 0.2, muted: "yes" })).toEqual({ ...DEFAULT_AUDIO, master: 1, engines: 0, gun: 0.2 });
    expect(sanitizeAudio({ muted: true }).muted).toBe(true);
  });
});

describe("pass-by voice", () => {
  it("bends the pitch down as the car goes by, fastest at the middle, without jumps", () => {
    let last = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const r = dopplerAt(u);
      expect(r).toBeLessThanOrEqual(last + 1e-12);
      last = r;
    }
    expect(dopplerAt(0)).toBeGreaterThan(1.1);
    expect(dopplerAt(1)).toBeLessThan(0.9);
    expect(dopplerAt(0.5)).toBeCloseTo(1, 1);
    for (let u = 0; u < 1; u += 0.02) expect(Math.abs(dopplerAt(u + 0.02) - dopplerAt(u))).toBeLessThan(0.05); // a bend, not a step
    expect(dopplerAt(-1)).toBe(dopplerAt(0));
  });
  it("swells to a peak in the middle and is silent at both ends", () => {
    expect(swellAt(0)).toBe(0);
    expect(swellAt(1)).toBeCloseTo(0, 10);
    expect(swellAt(0.5)).toBe(1);
    expect(swellAt(0.25)).toBeCloseTo(swellAt(0.75), 10);
    expect(swellAt(0.25)).toBeLessThan(1);
  });
  it("lasts as long as the car is on screen, within limits, and gives each car its own note", () => {
    expect(passVoice("A", 1000).duration).toBeCloseTo(2.56);
    expect(passVoice("A", 100000).duration).toBe(PASS_MIN_S);
    expect(passVoice("A", 1).duration).toBe(PASS_MAX_S);
    const notes = new Set(["BRA", "ALD", "GAN", "EAS", "DUN", "COV", "FAR", "KIN"].map((id) => passVoice(id, 1000).baseHz));
    expect(notes.size).toBeGreaterThan(4);
    for (const n of notes) expect(n >= 88 && n < 134).toBe(true);
    expect(passVoice("A", 1000)).toEqual(passVoice("A", 1000));
  });
  it("is quieter at high race speed, never silent", () => {
    expect(passVoice("A", 1000, 10).gain).toBeLessThan(passVoice("A", 1000, 1).gain);
    expect(passVoice("A", 1000, 1000).gain).toBeGreaterThan(0.1);
  });
});

describe("garage and pit gun", () => {
  it("clanks every 3 to 10 seconds", () => {
    expect(nextClankDelay(0)).toBe(3);
    expect(nextClankDelay(0.999)).toBeLessThan(10);
  });
  it("fires four guns a little apart, in order", () => {
    const t = gunTimes();
    expect(t).toHaveLength(4);
    expect(t[0]).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });
});

describe("PassGate", () => {
  const dur = () => 2000;
  it("sounds a car once when it comes in from the left, not while it stays on screen, and again on its next pass", () => {
    const g = new PassGate();
    expect(g.update([{ id: "A", fromLeft: true }], 0, dur)).toEqual(["A"]);
    expect(g.update([{ id: "A", fromLeft: true }], 100, dur)).toEqual([]);
    expect(g.update([], 3000, dur)).toEqual([]);
    expect(g.update([{ id: "A", fromLeft: true }], 90000, dur)).toEqual(["A"]);
  });
  it("is silent for cars that appear mid-screen (a restart, a reconnect)", () => {
    expect(new PassGate().update([{ id: "A", fromLeft: false }], 0, dur)).toEqual([]);
  });
  it("limits the passes per second and the voices at once", () => {
    const g = new PassGate(3, 10);
    const cars = Array.from({ length: 8 }, (_, i) => ({ id: `C${i}`, fromLeft: true }));
    expect(g.update(cars, 0, dur)).toHaveLength(3);
    const h = new PassGate(100, 2);
    expect(h.update(cars, 0, dur)).toHaveLength(2);
    expect(h.update([...cars, { id: "Z", fromLeft: true }], 2100, dur)).toHaveLength(1); // voices have ended; only the unseen car is new
  });
});
