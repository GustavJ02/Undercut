import { describe, expect, it } from "vitest";
import { DENY_KEYS, findLeaks, searchable } from "./leaks";
import { ModelStore, type Incoming } from "./store";
import { baseCars, baseResolver, fixture, hiddenOf, play } from "./testkit";
import { allSynth } from "./synth";

const NAMES = ["race-austin-5", "race-austin-8"];
const hiddenValues = (name: string) => {
  const nums: number[] = [];
  for (const sample of hiddenOf(`${name}.hidden.json`) as any[]) for (const car of Object.values<any>(sample)) nums.push(...Object.values<number>(car));
  return searchable(nums);
};

/** Every hidden field name and value, written into every car, own entry, event and clock of a message (what a leaking server would do). */
function pollute(m: Incoming, hidden: number[], salt: number): Incoming {
  const junk = (i: number) => ({
    pace_s: hidden[(salt + i) % hidden.length], pace_now: hidden[(salt + i + 1) % hidden.length], cliff_onset: hidden[(salt + i + 2) % hidden.length],
    tyre_loss_s: hidden[(salt + i + 3) % hidden.length], est_tyre_loss_s: hidden[(salt + i + 4) % hidden.length], reliability_state: hidden[(salt + i + 5) % hidden.length], seed: salt, secret_plan: ["pit", salt],
  });
  const c = structuredClone(m) as any;
  const view = c.view;
  if (view) {
    for (const [i, car] of view.cars.entries()) Object.assign(car, junk(i));
    for (const [i, o] of Object.values<any>(view.own).entries()) Object.assign(o, junk(i));
    Object.assign(view, junk(0));
  }
  if (c.event) Object.assign(c.event.payload, junk(1));
  if (c.type === "clock") Object.assign(c, junk(2));
  return c;
}

describe("the render model contains no hidden fields", () => {
  for (const name of NAMES) {
    const hidden = hiddenValues(name);

    it(`${name}: there are hidden values to look for, and none are in the public messages themselves`, () => {
      expect(hidden.size).toBeGreaterThan(500);
      const publicNums = new Set<number>();
      const walk = (v: unknown) => (typeof v === "number" ? publicNums.add(v) : v && typeof v === "object" ? Object.values(v).forEach(walk) : 0);
      for (const m of fixture(`${name}.json`)) if (m.type === "state") walk(m.view);
      const overlap = [...hidden].filter((v) => publicNums.has(v));
      expect(overlap).toEqual([]);
    });

    it(`${name}: no model built from the recorded race has a leak`, () => {
      const { models } = play(fixture(`${name}.json`));
      for (const m of models) expect(findLeaks(m, hidden)).toEqual([]);
      expect(JSON.stringify(models)).not.toMatch(DENY_KEYS);
    });

    it(`${name}: polluting every message with hidden fields changes nothing in the models`, () => {
      const msgs = fixture(`${name}.json`);
      const list = [...hidden];
      const clean = play(msgs).models;
      const dirty = play(msgs.map((m, i) => pollute(m, list, i * 7)));
      expect(JSON.stringify(dirty.models)).toEqual(JSON.stringify(clean));
      for (const m of dirty.models) expect(findLeaks(m, hidden)).toEqual([]);
    });
  }

  it("holds for fuzzed synthetic races too (seeds, safety car, retirements)", () => {
    const hidden = hiddenValues(NAMES[0]);
    const list = [...hidden];
    for (let seed = 1; seed <= 12; seed++) {
      const msgs = allSynth({ seed, carIds: baseCars(), laps: 3, lapS: 40, human: ["ALD"], safetyCar: seed % 2 ? [50, 80] : undefined, retire: seed % 3 ? { JES: 30 + seed } : undefined });
      const store = new ModelStore(baseResolver);
      msgs.map((m, i) => pollute(m, list, seed * 31 + i)).forEach((m, i) => store.push(m, i * 16));
      expect(findLeaks(store.model, hidden)).toEqual([]);
    }
  });
});

describe("the leak detector itself (mutation checks)", () => {
  const { models } = play(fixture("race-austin-8.json"));
  const hidden = hiddenValues("race-austin-8");
  const secret = [...hidden][0];

  it("passes a clean model", () => expect(findLeaks(models[5], hidden)).toEqual([]));

  it("catches a hidden key added anywhere", () => {
    const m: any = structuredClone(models[5]);
    m.cars[2].pace_s = 1;
    expect(findLeaks(m, hidden).join()).toContain("model.cars[2].pace_s: key names hidden state");
    const n: any = structuredClone(models[5]);
    n.cues = [{ id: "x", type: "radio", tick: 1, est_note: 1 }];
    expect(findLeaks(n, hidden).join()).toContain("est_note");
  });

  it("catches a field that is not part of the render model", () => {
    const m: any = structuredClone(models[5]);
    m.cars[0].driver = "Someone";
    m.cars[0].livery.sponsor = "x";
    const found = findLeaks(m, hidden).join();
    expect(found).toContain("model.cars[0].driver: not a render model field");
    expect(found).toContain("livery.sponsor: not a render model field");
  });

  it("catches a hidden value hiding under an innocent name", () => {
    const m: any = structuredClone(models[5]);
    m.cars[1].speed = secret;
    m.t = secret;
    expect(findLeaks(m, hidden).join()).toContain("equals a hidden engine value");
  });

  it("only searches numbers specific enough to mean something", () => {
    expect([...searchable([0, 1, 0.5, 0.25, 3.14159, -0.12345])].sort()).toEqual([-0.12345, 3.14159]);
  });
});
