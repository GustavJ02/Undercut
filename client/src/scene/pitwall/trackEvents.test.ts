import { describe, expect, it } from "vitest";
import type { CarRow, View } from "../../types";
import { eventNote, trackEvent } from "./trackEvents";

const car = (id: string, position: number, status: CarRow["status"] = "RUNNING") => ({ id, position, status }) as CarRow;
const view = (session: string, cars: CarRow[]) => ({ session, cars }) as unknown as View;

describe("trackEvent", () => {
  const base = view("RACING", [car("A", 3), car("B", 4), car("C", 5)]);
  it("is quiet while nothing happens to our cars", () => {
    expect(trackEvent(base, view("RACING", [car("A", 3), car("B", 4), car("C", 6)]), ["A", "B"])).toBeNull();
  });
  it("sees our car enter the pits, change position and a safety car", () => {
    expect(trackEvent(base, view("RACING", [car("A", 3, "IN_PIT"), car("B", 4), car("C", 5)]), ["A"])).toBe("stop");
    expect(trackEvent(base, view("RACING", [car("A", 4), car("B", 3), car("C", 5)]), ["A"])).toBe("overtake");
    expect(trackEvent(base, view("SC", base.cars), ["A"])).toBe("safety");
  });
  it("does not count the grid, nor places lost in the pit lane", () => {
    expect(trackEvent(view("GRID", base.cars), view("RACING", [car("A", 5), car("B", 4), car("C", 3)]), ["A"])).toBeNull();
    expect(trackEvent(view("RACING", [car("A", 3, "IN_PIT")]), view("RACING", [car("A", 9, "IN_PIT")]), ["A"])).toBeNull();
  });
});

describe("eventNote", () => {
  it("names each event for the caption over the band", () => {
    expect(eventNote("stop", "RACING")).toBe("Pit stop");
    expect(eventNote("overtake", "RACING")).toBe("Position change");
    expect(eventNote("safety", "VSC")).toBe("Virtual safety car");
    expect(eventNote("safety", "RED")).toBe("Red flag");
    expect(eventNote("safety", "SC")).toBe("Safety car");
  });
});
