import { describe, expect, it } from "vitest";
import { describe as describeEvent, initialState, reduce } from "./state";
import type { Clock, RaceInfo, View } from "./types";
import { trackPoint } from "./components/TrackMap";

const view = (over: Partial<View> = {}): View => ({
  time_s: 0, session: "RACING", track_status: "AllClear", race_lap: 1, total_laps: 10, own: {},
  cars: [{ id: "GAN", team: "OQY", driver: "Galen Gantry", position: 1, lap: 0, lap_frac: 0.1, status: "RUNNING", compound: "MEDIUM",
    tyre_age: 0, stops: 0, compounds_used: ["MEDIUM"], sets_remaining: {}, last_lap_s: null, gap_to_leader_s: 0, interval_s: null, laps_down: 0 }], weather: null,
  ...over,
});
const clock: Clock = { time_s: 0, tick: 0, speed: 1, paused: false, pause_allowed: true, session: "RACING" };
const info: RaceInfo = { id: "x", circuit: "Test", total_laps: 10, human_team: "OQY", human_cars: ["GAN"] };

describe("race state reducer", () => {
  it("a snapshot replaces the state and replays its history as messages", () => {
    const s = reduce(initialState, { type: "snapshot", info, view: view(), clock, history: [
      { tick: 3, type: "box_ack", payload: { car: "GAN", message: "Box confirmed, hard" } },
      { tick: 4, type: "lap", payload: { car: "GAN" } },
    ] });
    expect(s.info?.id).toBe("x");
    expect(s.messages.map((m) => m.text)).toEqual(["GAN: Box confirmed, hard"]);
  });

  it("state and clock messages update the view and clock without losing messages", () => {
    let s = reduce(initialState, { type: "event", event: { tick: 1, type: "safety_deployed", payload: { kind: "SC" } } });
    s = reduce(s, { type: "state", view: view({ race_lap: 5 }) });
    s = reduce(s, { type: "clock", ...clock, paused: true });
    expect(s.view?.race_lap).toBe(5);
    expect(s.clock?.paused).toBe(true);
    expect(s.messages[0].text).toBe("SAFETY CAR DEPLOYED");
  });

  it("errors are shown until the next state arrives", () => {
    let s = reduce(initialState, { type: "error", message: "not one of your cars" });
    expect(s.error).toBe("not one of your cars");
    s = reduce(s, { type: "state", view: view() });
    expect(s.error).toBeNull();
  });

  it("newest message first, capped", () => {
    let s = initialState;
    for (let i = 0; i < 200; i++) s = reduce(s, { type: "event", event: { tick: i, type: "retirement", payload: { car: "GAN" } } });
    expect(s.messages.length).toBe(120);
    expect(s.messages[0].key).toBeGreaterThan(s.messages[1].key);
  });

  it("events without a message produce none", () => {
    expect(describeEvent({ tick: 1, type: "lap", payload: {} }, null)).toBeNull();
  });
});

describe("track map", () => {
  it("puts the start line at the top and goes round once", () => {
    const a = trackPoint(0);
    const b = trackPoint(1);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeLessThan(trackPoint(0.5).y);
  });
});

import { newTrack, position, update } from "./smooth";

describe("position smoothing", () => {
  it("moves a car on at the speed it showed between the last two states, but not past 1.5 intervals or when paused", () => {
    let t = update(newTrack(), { GAN: 0.1 }, 1000);
    t = update(t, { GAN: 0.11 }, 1500); // 0.01 of a lap in 500 ms
    expect(position(t, "GAN", 1500, false)).toBeCloseTo(0.11);
    expect(position(t, "GAN", 1750, false)).toBeCloseTo(0.115);
    expect(position(t, "GAN", 9000, false)).toBeCloseTo(0.11 + 0.01 * 1.5); // capped at 1.5 intervals
    expect(position(t, "GAN", 1750, true)).toBeCloseTo(0.11);
  });

  it("handles the lap wrap and never smooths a teleport", () => {
    let t = update(newTrack(), { GAN: 0.995 }, 0);
    t = update(t, { GAN: 0.005 }, 500);
    expect(t.rate.GAN).toBeGreaterThan(0);
    t = update(t, { GAN: 0.6 }, 1000); // e.g. after a reconnect: no rate
    expect(t.rate.GAN).toBeUndefined();
    expect(position(t, "GAN", 1200, false)).toBeCloseTo(0.6);
  });
});

import { deltaText, fixed, headlines, largeButNoisy, meaningful, signed, verdict } from "./debrief";
import type { DebriefDecision, DebriefOption, DebriefReport, DebriefSummary } from "./types";

const summary = (over: Partial<DebriefSummary> = {}): DebriefSummary => ({ actual_points: 33, actual_position: 2.5, baseline_points: 14.5, baseline_points_se: 1, expected_points: 29.6,
  expected_points_se: 1.6, expected_points_sd: 7, skill_points: 15.1, skill_points_se: 1.6, skill_places: 2.9, skill_places_se: 0.4, luck_points: 3.4, score: 95, score_low: 90, score_high: 98, penalty_places: 0, penalty_points: 0, baseline_position: 7.2,
  expected_position: 4.3, drivers: [], biggest_miss: null, worst_contribution: null, ...over });
const option = (over: Partial<DebriefOption> = {}): DebriefOption => ({ id: "x", name: "Box soft", taken: false, default: false, points: 9, delta_points: -2.5, delta_points_se: 1.1,
  places: -0.8, places_se: 0.3, verdict: "same", ...over });
const decision = (over: Partial<DebriefDecision> = {}): DebriefDecision => ({ index: 1, kind: "call", car: "EAS", lap: 10, tick: 100, call: "Box hard", value_after: 20, contribution_points: 0.2,
  contribution_points_se: 1, contribution_places: 0, contribution_places_se: 0.2, best: "taken", miss_points: 0, miss_places: 0, significant: false,
  options: [option({ id: "taken", taken: true, verdict: "taken", delta_points: 0, delta_points_se: 0, places: 0, places_se: 0 })], ...over });

describe("debrief wording", () => {
  it("says skill and luck in separate sentences, so a good result is not mistaken for luck", () => {
    const v = verdict(summary());
    expect(v.skill).toContain("clearly better than the default strategy, worth +15.1 points");
    expect(v.skill).toContain("not luck");
    expect(v.luck).toContain("about as expected");
    expect(v.luck).toContain("normal swing is ±7");
  });
  it("calls a difference within noise 'about as good'", () => {
    expect(verdict(summary({ skill_points: 1, skill_points_se: 2 })).skill).toContain("about as good as the default strategy");
  });
  it("does not talk about a swing when every simulated outcome was the same", () => {
    expect(verdict(summary({ expected_points_sd: 0, luck_points: 0 })).luck).toContain("hardly any");
  });
  it("does not say 'hardly any' luck when the race was far from every simulated future", () => {
    const l = verdict(summary({ expected_points_sd: 0.4, luck_points: 6.9 })).luck;
    expect(l).toContain("went better than your calls would usually give");
    expect(l).toContain("+6.9 points");
    expect(l).toContain("±0.4");
  });
  it("names bad luck and bad calls", () => {
    const v = verdict(summary({ skill_points: -6, skill_points_se: 1, luck_points: -9 }));
    expect(v.skill).toContain("clearly worse");
    expect(v.luck).toContain("went worse than your calls would usually give");
  });
  it("shows an alternative's gain with its uncertainty, and the taken option as taken", () => {
    expect(deltaText(option())).toBe("−2.5 ± 1.1 pts, places −0.8");
    expect(deltaText(option({ taken: true }))).toBe("taken");
  });
  it("never prints a signed zero", () => {
    expect(fixed(-0.04)).toBe("0.0");
    expect(signed(-0.04)).toBe("0.0");
    expect(signed(0)).toBe("0.0");
    expect(signed(-2.56)).toBe("−2.6");
    expect(signed(4.7)).toBe("+4.7");
  });
});

describe("which decisions open", () => {
  it("opens a clear miss, a clear contribution or a clearly worse option, and collapses the rest", () => {
    expect(meaningful(decision())).toBe(false);
    expect(meaningful(decision({ significant: true }))).toBe(true);
    expect(meaningful(decision({ contribution_points: 4, contribution_points_se: 1 }))).toBe(true);
    expect(meaningful(decision({ options: [option({ verdict: "worse" })] }))).toBe(true);
  });
  it("opens a large contribution even when it is within the noise (B22), and says so", () => {
    const swap = decision({ kind: "swap", contribution_points: -4.3, contribution_points_se: 3, contribution_places: -0.4 });
    expect(meaningful(swap)).toBe(true);
    expect(largeButNoisy(swap)).toBe(true);
    expect(meaningful(decision({ contribution_points: 0.4, contribution_points_se: 3, contribution_places: -1.2 }))).toBe(true);       // a place or more
    expect(meaningful(decision({ contribution_points: 1.9, contribution_points_se: 3, contribution_places: 0.9 }))).toBe(false);      // below both thresholds
    expect(largeButNoisy(decision({ contribution_points: -4.3, contribution_points_se: 0.5 }))).toBe(false);                           // clear, not noisy
  });
  it("headlines the biggest miss, and the costliest contribution when it is another decision", () => {
    const a = decision({ index: 1, significant: true, miss_points: 7.8 });
    const b = decision({ index: 2, contribution_points: -6, contribution_points_se: 1 });
    const r = { summary: summary({ biggest_miss: 1, worst_contribution: 2 }), decisions: [a, b] } as DebriefReport;
    expect(headlines(r)).toEqual({ miss: a, costly: b });
    const same = { summary: summary({ biggest_miss: 1, worst_contribution: 1 }), decisions: [{ ...a, contribution_points: -6, contribution_points_se: 1 }] } as DebriefReport;
    expect(headlines(same).costly).toBeNull();
    expect(headlines({ summary: summary({ biggest_miss: 2 }), decisions: [b] } as DebriefReport).miss).toBeNull();
  });
});

import { gap } from "./format";

describe("gap column", () => {
  it("shows the leader, a lapped car in laps, and others in seconds", () => {
    expect(gap(0, true)).toBe("Leader");
    expect(gap(null, false, 1)).toBe("+1 lap");
    expect(gap(null, false, 2)).toBe("+2 laps");
    expect(gap(12.34)).toBe("+12.3");
    expect(gap(null)).toBe("");
  });
});

describe("red flag messages", () => {
  it("announces the red flag, free tyre changes and the restart", () => {
    expect(describeEvent({ tick: 5, type: "red_flag", payload: { lap: 3 } }, null)?.text).toContain("RED FLAG");
    expect(describeEvent({ tick: 9, type: "tyre_change", payload: { car: "GAN", compound: "HARD" } }, null)?.text).toBe("GAN changes to hard tyres (red flag)");
    expect(describeEvent({ tick: 99, type: "restart", payload: { lap: 4 } }, null)?.level).toBe("alert");
  });
});

import { outlook, tyreChoices, wetRelevant } from "./weatherUi";

describe("weather ui", () => {
  const dryView = view({ weather: { raining: false, track: "dry", wet_race_declared: false, forecast_pre_race_pct: 10, forecast_next_laps: Array(10).fill(0.05) } });
  it("offers wet tyres only when weather could matter", () => {
    expect(wetRelevant(view())).toBe(false);
    expect(tyreChoices(dryView)).toEqual(["SOFT", "MEDIUM", "HARD"]);
    const rain = view({ weather: { ...dryView.weather!, raining: true } });
    expect(tyreChoices(rain)).toContain("INTERMEDIATE");
    expect(wetRelevant(view({ weather: { ...dryView.weather!, forecast_pre_race_pct: 60 } }))).toBe(true);
  });
  it("words the outlook", () => {
    expect(outlook(dryView.weather!)).toBe("No rain expected in the next 10 laps");
    const f = [0.1, 0.1, 0.7, 0.4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    expect(outlook({ ...dryView.weather!, forecast_next_laps: f })).toBe("Rain chance up to 70% around lap +3");
  });
});

describe("the lap table", () => {
  const lap = (n: number, flags = "") => ({ tick: n, type: "lap", payload: { car: "GAN", lap: n, lap_time: 80 + n, compound: "MEDIUM", age: n, flags } });
  it("starts from the snapshot's table, adds live laps once and keeps them in order", () => {
    let s = reduce(initialState, { type: "snapshot", info, view: view(), clock, history: [lap(2)], laps: { GAN: [[1, 81, "MEDIUM", 1, ""], [2, 82, "MEDIUM", 2, ""]] } });
    expect(s.laps.GAN.map((r) => r[0])).toEqual([1, 2]); // history repeats lap 2: not counted twice
    s = reduce(s, { type: "event", event: lap(4, "P") });
    s = reduce(s, { type: "event", event: lap(3) });
    s = reduce(s, { type: "event", event: lap(3) });
    expect(s.laps.GAN.map((r) => r[0])).toEqual([1, 2, 3, 4]);
    expect(s.laps.GAN[3][4]).toBe("P");
  });
  it("is replaced by a new snapshot, as after a reconnect", () => {
    let s = reduce(initialState, { type: "snapshot", info, view: view(), clock, history: [], laps: { GAN: [[1, 81, "MEDIUM", 1, ""]] } });
    s = reduce(s, { type: "snapshot", info, view: view(), clock, history: [], laps: { GAN: [[1, 81, "MEDIUM", 1, ""], [2, 80, "MEDIUM", 2, ""]] } });
    expect(s.laps.GAN).toHaveLength(2);
  });
});
