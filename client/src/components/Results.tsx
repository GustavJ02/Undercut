import { RULE_TEXT } from "../rules";
import { gap, lapTime } from "../format";
import { useNames } from "../hooks";
import { resultRows } from "../strategy/results";
import type { LapTable, RaceInfo, View } from "../types";
import { circuitName } from "./setup/circuits";

/** The race result as a screen of its own: classification with gap, best lap and a bar of each car's tyre stints. */
export function Results({ view, info, laps, onDebrief, onLeave }: { view: View; info: RaceInfo; laps: LapTable; onDebrief?: () => void; onLeave: () => void }) {
  const names = useNames();
  const rows = resultRows(view.cars, laps);
  return (
    <section className="results-screen" aria-label="Race result">
      <div className="results-head">
        <h2>{names.circuit(info.circuit, circuitName(info.circuit))}: result</h2>
        <span className="spacer" />
        {onDebrief && <button className="primary" onClick={onDebrief}>Debrief</button>}
        <button onClick={onLeave}>New race</button>
      </div>
      <table className="results">
        <thead>
          <tr>
            <th>P</th><th>Driver</th><th>Gap</th><th>Best lap</th><th>Stops</th><th>Tyres, lap by lap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ car, best, fastest, stints }, i) => {
            const out = car.status === "RETIRED";
            return (
              <tr key={car.id} className={`${info.human_cars.includes(car.id) ? "mine" : ""} ${out ? "retired" : ""}`}>
                <td>{out ? "–" : i + 1}</td>
                <td><span className="drv">{names.driverShort(car.id)}</span> {names.driver(car.id)}</td>
                <td className="key">{out ? "retired" : car.penalised ? <span title={RULE_TEXT}>penalty</span> : gap(car.gap_to_leader_s, i === 0, car.laps_down)}</td>
                <td className={fastest ? "fastest" : ""}>{lapTime(best)}{fastest && <span title="Fastest lap of the race"> ★</span>}</td>
                <td>{car.stops}</td>
                <td>
                  <div className="stint-bar" role="img" aria-label={stints.map((s) => `${s.laps} laps on ${s.compound.toLowerCase()}`).join(", ")}>
                    {stints.map((s, k) => (
                      <span key={k} className={`run run-${s.compound.toLowerCase()}`} style={{ flexGrow: s.laps }} title={`${s.laps} laps on ${s.compound.toLowerCase()}`}>{s.laps}</span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.car.penalised) && (
        <p className="muted small penalty">
          Penalty: {rows.filter((r) => r.car.penalised).map((r) => names.driver(r.car.id)).join(", ")} finished on a single dry compound and are classified last. {RULE_TEXT}
        </p>
      )}
    </section>
  );
}
