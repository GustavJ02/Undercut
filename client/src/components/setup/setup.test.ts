import { describe, expect, it } from "vitest";
import { CHAOS_KEYS, CHAOS_MAX, MAYHEM, REALISTIC, chaosRequest, matchesPreset } from "./ChaosPanel";
import { CIRCUITS, byName, circuitMeta, circuitName } from "./circuits";

describe("chaos mode", () => {
  it("sends nothing when it is off, so the race is the realistic one", () => {
    expect(chaosRequest({ on: false, values: { ...MAYHEM } })).toEqual({});
  });
  it("sends exactly the keys the engine knows, within the slider range", () => {
    const engine = ["incident_rate", "reliability_rate", "first_lap_chaos", "sc_response_bias"];
    expect(CHAOS_KEYS.map((k) => k.key).sort()).toEqual([...engine].sort());
    for (const v of [REALISTIC, MAYHEM]) {
      const sent = chaosRequest({ on: true, values: v });
      expect(Object.keys(sent).sort()).toEqual([...engine].sort());
      expect(Object.values(sent).every((x) => x >= 0 && x <= CHAOS_MAX)).toBe(true);
    }
  });
});

describe("circuit descriptions", () => {
  it("know the circuits of the bundle and fall back to the id for others", () => {
    expect(Object.keys(CIRCUITS)).toHaveLength(23);
    expect(circuitMeta("Somewhere_New").place).toBe("Somewhere New");
  });
});

describe("circuit names", () => {
  it("are the town or region, one per circuit, and the list is alphabetical", () => {
    const ids = Object.keys(CIRCUITS);
    const names = ids.map(circuitName);
    expect(ids).toHaveLength(23);
    expect(new Set(names).size).toBe(ids.length);
    expect(circuitName("northamptonshire")).toBe("Northamptonshire");
    expect(circuitName("monza")).toBe("Monza");
    expect(circuitName("madrid")).toBe("Madrid");
    expect(byName(["madrid", "monaco", "barcelona"])).toEqual(["barcelona", "madrid", "monaco"]);
    expect(ids.every((id) => /^[a-z0-9_]+$/.test(id))).toBe(true);
  });
});


describe("chaos presets", () => {
  it("show as chosen only while the sliders sit exactly on them", () => {
    expect(matchesPreset({ ...REALISTIC }, REALISTIC)).toBe(true);
    expect(matchesPreset({ ...MAYHEM }, MAYHEM)).toBe(true);
    expect(matchesPreset({ ...MAYHEM }, REALISTIC)).toBe(false);
    expect(matchesPreset({ ...REALISTIC, incident_rate: 1.25 }, REALISTIC)).toBe(false);
  });
});
