import { outlook, trackText } from "../weatherUi";
import type { View } from "../types";

export function WeatherPanel({ view }: { view: View }) {
  const w = view.weather;
  if (!w) return null;
  return (
    <section className="weather" aria-label="Weather">
      <h3>
        <span className={w.raining ? "rain-on" : "rain-off"}>{w.raining ? "🌧" : "☀"}</span> {trackText(w)}
        {w.wet_race_declared && <span className="muted small"> · wet race declared</span>}
      </h3>
      <div className="forecast" title="Chance of rain in each of the next 10 laps">
        {w.forecast_next_laps.map((p, i) => (
          <div key={i} className="fbar" style={{ height: `${Math.max(4, p * 36)}px`, opacity: 0.35 + 0.65 * p }} />
        ))}
      </div>
      <p className="muted small">
        {outlook(w)}. Pre-race forecast: {w.forecast_pre_race_pct}% chance of rain.
      </p>
    </section>
  );
}
