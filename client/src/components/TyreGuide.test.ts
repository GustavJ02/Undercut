import { describe, expect, it } from "vitest";
import { cliffText } from "./TyreGuide";

describe("cliffText", () => {
  it("says the range inside the race, and cuts it off at the finish", () => {
    expect(cliffText(22, 54, 58)).toBe("laps 22 to 54");
    expect(cliffText(22, 54, 40)).toBe("from lap 22, may not come");
    expect(cliffText(22, 54, 15)).toBe("not within this race");
  });
});
