import { describe, expect, it } from "vitest";
import { checkMessage } from "../contract/contract";
import { interpolate, toRenderModel, cuesFor, YELLOW_HOLD_S, type RenderModel } from "./model";
import { allSynth } from "./synth";
import { baseCars, baseResolver, fixture, play } from "./testkit";

const race = () => allSynth({ seed: 1, carIds: baseCars(), laps: 4, lapS: 60, human: ["ALD", "BRA"], safetyCar: [100, 140], retire: { JES: 80 }, pitLaps: [1] });
const SYNTH = race();

describe("the synthetic race", () => {
  it("fits the server contract, so tests built on it say something about the real thing", () => {
    expect(SYNTH.flatMap((m, i) => checkMessage(m).map((p) => `#${i} ${p}`))).toEqual([]);
  });
  it("is deterministic and has pit stops, a safety car, a retirement and a classification", () => {
    expect(JSON.stringify(race())).toEqual(JSON.stringify(SYNTH));
    const kinds = new Set(SYNTH.filter((m) => m.type === "event").map((m: any) => m.event.type));
    for (const k of ["pit_in", "pit_out", "safety_deployed", "safety_ended", "retirement", "finish", "classification"]) expect(kinds.has(k), k).toBe(true);
  });
});

describe("render model invariants (synthetic and recorded races)", () => {
  const runs: [string, ReturnType<typeof play>][] = [
    ["synthetic", play(SYNTH)],
    ["recorded 5", play(fixture("race-austin-5.json"))],
    ["recorded 8", play(fixture("race-austin-8.json"))],
  ];
  for (const [name, { models }] of runs) {
    it(`${name}: cars in id order, positions 1..n, fractions in [0,1), finite numbers`, () => {
      expect(models.length).toBeGreaterThan(10);
      for (const m of models) {
        const ids = m.cars.map((c) => c.id);
        expect(ids).toEqual([...ids].sort());
        expect(m.cars.map((c) => c.position).sort((a, b) => a - b)).toEqual(m.cars.map((_, i) => i + 1));
        for (const c of m.cars) {
          expect(c.lapFrac).toBeGreaterThanOrEqual(0);
          expect(c.lapFrac).toBeLessThan(1);
          expect(Number.isFinite(c.speed) && c.speed >= 0).toBe(true);
          expect(c.livery.number).toBe(baseResolver.driver(c.id).number);
        }
        expect(m.contract).toBe(1);
      }
    });

    it(`${name}: time never goes backwards and every cue id is unique`, () => {
      for (let i = 1; i < models.length; i++) expect(models[i].t).toBeGreaterThanOrEqual(models[i - 1].t);
      const ids = models.flatMap((m) => m.cues.map((c) => c.id));
      expect(new Set(ids).size).toBe(ids.length);
    });
  }

  it("mine is the human cars, sorted; pit lane lists exactly the cars in the lane, with a stable start time", () => {
    const { models } = play(SYNTH);
    expect(models[0].mine).toEqual(["ALD", "BRA"]);
    const inLane = models.filter((m) => m.pitLane.length);
    expect(inLane.length).toBeGreaterThan(0);
    for (const m of models) expect(m.pitLane.map((p) => p.car).sort()).toEqual(m.cars.filter((c) => c.status === "IN_PIT").map((c) => c.id).sort());
    const since = new Map<string, number>();
    for (const m of models) for (const p of m.pitLane) expect(since.get(p.car) ?? p.sinceT).toBe((since.set(p.car, since.get(p.car) ?? p.sinceT), p.sinceT));
  });
});

describe("speed and interpolation", () => {
  const { models } = play(SYNTH);
  const mid = models[400];

  it("derives about the right speed from successive states", () => {
    const c = mid.cars.find((x) => x.status === "RUNNING" && !mid.pitLane.some((p) => p.car === x.id))!;
    const lapsPerS = 1 / 60;
    expect(c.speed).toBeGreaterThan(lapsPerS * 0.3);
    expect(c.speed).toBeLessThan(lapsPerS * 1.3);
  });

  it("never moves a car backwards, wraps at the line, and stops extrapolating after 1.5 state intervals", () => {
    for (const c of mid.cars) {
      let last = c.lapFrac, wraps = 0;
      for (let s = 0; s <= 3; s += 0.05) {
        const f = interpolate(mid, c, s, false);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(1);
        if (f < last - 0.5) wraps++;
        else expect(f).toBeGreaterThanOrEqual(last - 1e-12);
        last = f;
      }
      expect(wraps).toBeLessThanOrEqual(1);
      expect(interpolate(mid, c, 3, false)).toBe(interpolate(mid, c, 100, false));
      expect(interpolate(mid, c, 100, true)).toBe(c.lapFrac);
    }
  });

  it("no frame-to-frame jump larger than a car's real movement, including across state updates (no teleports)", () => {
    const { store } = play(SYNTH.slice(0, 3));
    const frames: Record<string, number>[] = [];
    let wall = 1000;
    const rest = SYNTH.slice(3, 1200);
    let i = 0;
    while (i < rest.length) {
      // one state every 500 ms wall (1x), drawn at 60 fps in between
      while (i < rest.length && rest[i].type !== "state") store.push(rest[i++], wall);
      if (i < rest.length) store.push(rest[i++], wall);
      for (let f = 0; f < 30; f++) frames.push(Object.fromEntries(store.model!.cars.map((c) => [c.id, store.lapFrac(c, wall + f * 16.67)])));
      wall += 500;
    }
    let worst = 0;
    for (let k = 1; k < frames.length; k++)
      for (const id of Object.keys(frames[k])) {
        let d = frames[k][id] - frames[k - 1][id];
        if (d < -0.5) d += 1;
        worst = Math.max(worst, Math.abs(d));
      }
    expect(worst).toBeLessThan(0.01); // a car covers 1/60 lap per second: well under 0.01 in 16 ms
  });
});

describe("corners", () => {
  it("passes the turn numbers and positions through, and has none when the server sends none", () => {
    const { models } = play(SYNTH);
    expect(models[5].corners).toHaveLength(18);
    expect(models[5].corners[0]).toEqual({ n: 1, frac: 0.0278 });
    const bare = fixture("race-austin-5.json");
    delete (bare[0] as unknown as { info: { corners?: unknown } }).info.corners;
    expect(play(bare).models[3].corners).toEqual([]);
  });
});

describe("lighting and cues", () => {
  const { models } = play(SYNTH);
  it("follows the session: green, sc, chequered", () => {
    const seen = new Set(models.map((m) => m.lighting));
    expect(seen).toEqual(new Set(["green", "sc", "chequered"]));
    expect(models.find((m) => m.session === "SC")!.lighting).toBe("sc");
  });
  it("a local yellow lights yellow for a while, then clears", () => {
    const base = models[10];
    const input = { view: { ...base, time_s: base.t + 1 } as never, clock: { tick: 1, speed: 1, paused: false }, info: { circuit: "x", total_laps: 1, human_team: null, human_cars: [] }, events: [{ tick: 1, type: "local_yellow", payload: { car: "ALD", lap: 1 } }] };
    const view = { time_s: 100, session: "RACING", track_status: "AllClear", race_lap: 1, total_laps: 5, cars: [], own: {} } as const;
    const m1 = toRenderModel(null, { ...input, view: view as never }, baseResolver);
    expect(m1.lighting).toBe("yellow");
    const m2 = toRenderModel(m1, { ...input, view: { ...view, time_s: 100 + YELLOW_HOLD_S + 1 } as never, events: [] }, baseResolver);
    expect(m2.lighting).toBe("green");
  });
  it("turns events into cues and ignores the rest", () => {
    expect(cuesFor({ tick: 1, type: "pass", payload: { car: "A", passed: "B" } })).toEqual([{ tick: 1, type: "passBy", car: "A", other: "B" }]);
    expect(cuesFor({ tick: 1, type: "box_ack", payload: { car: "A", ok: false } })).toEqual([]);
    expect(cuesFor({ tick: 1, type: "lap", payload: {} })).toEqual([]);
    expect(cuesFor({ tick: 9, type: "classification", payload: { order: ["Z", "Y"] } })[0]).toMatchObject({ type: "win", car: "Z" });
  });
  it("cues come from events that arrived with the state, and history in a snapshot is not replayed", () => {
    const withHistory = structuredClone(SYNTH);
    (withHistory[0] as any).history = [{ tick: 0, type: "retirement", payload: { car: "ALD", lap: 1 } }];
    const { store } = play(withHistory.slice(0, 1));
    expect(store.cuesSince(0).cues).toEqual([]);
    const all = play(SYNTH).store.cuesSince(0);
    expect(all.cues.some((c) => c.type === "scDeployed")).toBe(true);
    expect(play(SYNTH).store.cuesSince(all.next).cues).toEqual([]);
  });
});

describe("snapshot of a recorded state", () => {
  it("matches the stored render model of the first 3 cars at the 20th state", () => {
    const m: RenderModel = play(fixture("race-austin-8.json")).models[20];
    const brief = { ...m, cars: m.cars.slice(0, 3).map((c) => ({ ...c, lapFrac: +c.lapFrac.toFixed(3), speed: +c.speed.toFixed(5) })), pitLane: [], cues: m.cues.map((c) => ({ type: c.type, car: c.car })) };
    expect(brief).toMatchSnapshot();
  });
});
