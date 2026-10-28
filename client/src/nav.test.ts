import { describe, expect, it } from "vitest";
import { debriefFromHash, raceFromSearch, raceUrl } from "./nav";

describe("addresses of a race", () => {
  it("names a race in the query and reads it back, whatever the id looks like", () => {
    expect(raceFromSearch(raceUrl("8P8EK").slice(1))).toBe("8P8EK");
    expect(raceFromSearch("?race=aB3_-xYz")).toBe("aB3_-xYz");
    expect(raceFromSearch("")).toBeNull();
    expect(raceFromSearch("?race=")).toBeNull();
  });
  it("ignores anything that is not shaped like a room id", () => {
    expect(raceFromSearch("?race=../../etc")).toBeNull();
    expect(raceFromSearch("?race=ab")).toBeNull();
    expect(raceFromSearch("?race=" + "x".repeat(40))).toBeNull();
  });
  it("tells the Debrief from the results by the hash", () => {
    expect(debriefFromHash("#debrief")).toBe(true);
    expect(debriefFromHash("")).toBe(false);
    expect(debriefFromHash("#other")).toBe(false);
  });
});
