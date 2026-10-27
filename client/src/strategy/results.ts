/** The numbers on the results screen, from the final view and the public lap table. Pure, so they are tested as data. */
import type { CarRow, LapTable } from "../types";
import { stintsOf } from "./analysis";

export interface ResultRow {
  car: CarRow;
  best: number | null; // seconds
  fastest: boolean; // the fastest lap of the race
  stints: { compound: string; laps: number }[];
}

/** One row per car in classified order: finishers by position, then the retirements. */
export function resultRows(cars: CarRow[], laps: LapTable): ResultRow[] {
  const best = (id: string): number | null => {
    const times = (laps[id] ?? []).filter((r) => r[0] > 1 || r[1] > 0).map((r) => r[1]);
    return times.length ? Math.min(...times) : null;
  };
  const rows = cars.map((car) => ({ car, best: best(car.id), fastest: false, stints: stintsOf(laps[car.id] ?? []).map((s) => ({ compound: s.compound, laps: s.laps.length })) }));
  const quickest = Math.min(...rows.map((r) => r.best ?? Infinity));
  for (const r of rows) r.fastest = r.best !== null && r.best === quickest;
  return rows.sort((a, b) => Number(a.car.status === "RETIRED") - Number(b.car.status === "RETIRED") || a.car.position - b.car.position);
}
