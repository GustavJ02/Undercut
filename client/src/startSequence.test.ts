import { describe, expect, it } from "vitest";
import { LIGHTS, STEP_S, litAt, lightTime, randomHold, totalS, HOLD_MAX_S, HOLD_MIN_S } from "./startSequence";

describe("start sequence", () => {
  it("lights come on one at a time, then stay", () => {
    expect(litAt(0)).toBe(0);
    for (let i = 0; i < LIGHTS; i++) {
      expect(litAt(lightTime(i) + 0.01)).toBe(i + 1);
      expect(litAt(lightTime(i) - 0.01)).toBe(i);
    }
    expect(litAt(60)).toBe(LIGHTS);
  });

  it("the race starts after the fifth light plus the hold", () => {
    expect(totalS(1)).toBeCloseTo(lightTime(4) + 1);
    expect(lightTime(1) - lightTime(0)).toBeCloseTo(STEP_S);
  });

  it("the hold is between its limits", () => {
    expect(randomHold(0)).toBe(HOLD_MIN_S);
    expect(randomHold(1)).toBe(HOLD_MAX_S);
  });
});
