import { describe, expect, it } from "vitest";
import type { CarRow, LapRow } from "../types";
import { resultRows } from "./results";

const car = (id: string, position: number, status: CarRow["status"] = "FINISHED") => ({ id, position, status }) as CarRow;
const lap = (n: number, t: number, c: LapRow[2], age: number, flags = ""): LapRow => [n, t, c, age, flags];

describe("resultRows", () => {
  const laps = {
    A: [lap(1, 95, "MEDIUM", 1), lap(2, 90, "MEDIUM", 2, "P"), lap(3, 91, "HARD", 1)],
    B: [lap(1, 96, "SOFT", 1), lap(2, 89.5, "SOFT", 2)],
  };
  it("finds each car's best lap, the fastest of the race and the stints", () => {
    const rows = resultRows([car("A", 1), car("B", 2)], laps);
    expect(rows.map((r) => [r.car.id, r.best, r.fastest])).toEqual([["A", 90, false], ["B", 89.5, true]]);
    expect(rows[0].stints).toEqual([{ compound: "MEDIUM", laps: 2 }, { compound: "HARD", laps: 1 }]);
  });
  it("puts retirements after the finishers and tolerates a car with no laps", () => {
    const rows = resultRows([car("A", 1, "RETIRED"), car("B", 2), car("C", 3)], laps);
    expect(rows.map((r) => r.car.id)).toEqual(["B", "C", "A"]);
    expect(rows[1].best).toBeNull();
  });
});
