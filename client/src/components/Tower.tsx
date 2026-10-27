import { gap, lapTime } from "../format";
import { useNames } from "../hooks";
import type { CarRow, View } from "../types";
import { Tyre } from "./Tyre";

/** The tyres a car has used, in order, for the tooltip: "Used soft, then hard (1 stop)". */
const stintHistory = (c: CarRow) => `Used ${c.compounds_used.map((x) => x.toLowerCase()).join(", then ")} (${c.stops} ${c.stops === 1 ? "stop" : "stops"})`;

export function Tower({ view, humanCars }: { view: View; humanCars: string[] }) {
  const names = useNames();
  return (
    <table className="tower">
      <thead>
        <tr>
          <th>P</th>
          <th>Driver</th>
          <th>Tyre</th>
          <th>Age</th>
          <th>Stops</th>
          <th className="key">Gap</th>
          <th className="key">Int</th>
          <th title="Gap to the car behind, for our cars">Behind</th>
          <th>Last lap</th>
        </tr>
      </thead>
      <tbody>
        {view.cars.map((c, i) => (
          <tr key={c.id} className={[humanCars.includes(c.id) ? "mine" : "", c.status.toLowerCase()].join(" ")}>
            <td>{c.position}</td>
            <td>
              <span className="drv" title={names.driver(c.id)}>{names.driverShort(c.id)}</span> {c.status === "IN_PIT" ? <span className="pit">PIT</span> : c.status === "RETIRED" ? <span className="out">OUT</span> : null}
            </td>
            <td>
              <Tyre compound={c.compound} />
            </td>
            <td>{c.tyre_age}</td>
            <td title={stintHistory(c)}>{c.stops > 0 ? <span className="stopped">{c.stops}</span> : c.stops}</td>
            <td className="key">{c.status === "RETIRED" ? "" : gap(c.gap_to_leader_s, c.position === 1, c.laps_down)}</td>
            <td className="key">{c.status === "RETIRED" ? "" : gap(c.interval_s)}</td>
            <td>{humanCars.includes(c.id) && view.cars[i + 1]?.status !== "RETIRED" && view.cars[i + 1]?.laps_down === c.laps_down ? gap(view.cars[i + 1]?.interval_s ?? null) : ""}</td>
            <td>{lapTime(c.last_lap_s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
