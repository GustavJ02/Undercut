import type { Compound, View } from "./types";
import { COMPOUNDS, DRY_COMPOUNDS } from "./types";

/** Should wet-weather tyres be offered? Only when weather could matter: rain, a wet track, a real chance of rain, or cars on them. */
export function wetRelevant(view: View): boolean {
  const w = view.weather;
  if (!w) return false;
  return w.raining || w.track !== "dry" || w.forecast_pre_race_pct >= 30 || w.forecast_next_laps.some((p) => p >= 0.5) ||
    view.cars.some((c) => c.compound === "INTERMEDIATE" || c.compound === "WET");
}

export const tyreChoices = (view: View): Compound[] => (wetRelevant(view) ? COMPOUNDS : DRY_COMPOUNDS);

export const trackText = (w: NonNullable<View["weather"]>): string =>
  `${w.raining ? "Raining" : "No rain"}, track ${w.track}`;

/** The chance of rain at its highest in the next laps, as a short sentence. */
export function outlook(w: NonNullable<View["weather"]>): string {
  const peak = Math.max(...w.forecast_next_laps);
  const lap = w.forecast_next_laps.findIndex((p) => p === peak) + 1;
  if (peak < 0.25) return "No rain expected in the next 10 laps";
  return `Rain chance up to ${Math.round(peak * 100)}% around ${lap === 1 ? "the next lap" : `lap +${lap}`}`;
}
