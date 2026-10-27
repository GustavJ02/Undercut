/** The mandatory-stop rule as the engine enforces it (engine/tick.py `_classify`): a car that finishes on fewer than two different dry
 * compounds is classified last, unless the race was declared wet or it used an intermediate or wet tyre. */
import type { CarRow, Compound, View } from "./types";
import { DRY_COMPOUNDS } from "./types";

export const RULE_TEXT = "Each car must use at least two different dry compounds (soft, medium, hard) during the race. A car that finishes without doing so is classified last, whatever its race time. The rule is waived in a race declared wet, or for a car that has used intermediates or wets.";

export interface RuleState {
  /** The car has satisfied the rule or can no longer be caught by it. */
  met: boolean;
  /** Why it does not apply, if it does not. */
  waived: boolean;
}

export function ruleState(view: Pick<View, "weather">, car: Pick<CarRow, "compounds_used">): RuleState {
  const used = new Set<Compound>(car.compounds_used);
  const waived = !!view.weather?.wet_race_declared || car.compounds_used.some((c) => !DRY_COMPOUNDS.includes(c));
  return { met: used.size >= 2, waived };
}

/** The warning for the driver's card: from half distance, while the rule is unmet and the car is still running. */
export function ruleWarning(view: View, car: CarRow, totalLaps: number, boxCalled: boolean): string | null {
  if (car.status === "RETIRED" || car.status === "FINISHED") return null;
  const { met, waived } = ruleState(view, car);
  if (met || waived || car.lap < Math.ceil(totalLaps / 2)) return null;
  const left = totalLaps - car.lap;
  return boxCalled
    ? null
    : `Stop rule not met: still on one compound. Box for a different dry compound before the flag (${left} ${left === 1 ? "lap" : "laps"} left) or be classified last.`;
}
