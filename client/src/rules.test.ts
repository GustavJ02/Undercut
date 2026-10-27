import { describe, expect, it } from "vitest";
import { ruleState, ruleWarning } from "./rules";
import type { CarRow, View } from "./types";

const car = (used: string[], lap = 20, status = "RUNNING") => ({ compounds_used: used, lap, status }) as unknown as CarRow;
const view = (wet = false) => ({ weather: { wet_race_declared: wet } }) as unknown as View;

describe("the stop rule", () => {
  it("is met by two dry compounds, waived by a wet tyre or a declared wet race", () => {
    expect(ruleState(view(), car(["MEDIUM", "HARD"])).met).toBe(true);
    expect(ruleState(view(), car(["MEDIUM"])).met).toBe(false);
    expect(ruleState(view(), car(["MEDIUM", "INTERMEDIATE"])).waived).toBe(true);
    expect(ruleState(view(true), car(["MEDIUM"])).waived).toBe(true);
  });
  it("warns only from half distance, while unmet, and only if no stop is called", () => {
    expect(ruleWarning(view(), car(["MEDIUM"], 9), 20, false)).toBeNull();
    expect(ruleWarning(view(), car(["MEDIUM"], 10), 20, false)).toContain("Stop rule not met");
    expect(ruleWarning(view(), car(["MEDIUM"], 10), 20, true)).toBeNull();
    expect(ruleWarning(view(), car(["MEDIUM", "HARD"], 10), 20, false)).toBeNull();
    expect(ruleWarning(view(true), car(["MEDIUM"], 10), 20, false)).toBeNull();
    expect(ruleWarning(view(), car(["MEDIUM"], 20, "FINISHED"), 20, false)).toBeNull();
  });
});
