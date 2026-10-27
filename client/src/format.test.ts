import { describe, expect, it } from "vitest";
import { plural } from "./format";

describe("plural", () => {
  it("says 1 lap, 0 laps and 2 laps", () => {
    expect(plural(1, "lap")).toBe("1 lap");
    expect(plural(0, "lap")).toBe("0 laps");
    expect(plural(2, "stop")).toBe("2 stops");
  });
});
