import { Gloss } from "./Gloss";
import { useState } from "react";
import { DRY_COMPOUNDS, type View } from "../types";
import { plural } from "../format";
import { useNames } from "../hooks";
import { rivalsAhead } from "../swapUi";
import { callDeadline, pitLossNow, rejoinAfterStop, tyreLoss } from "../strategy/analysis";
import { ruleWarning } from "../rules";
import { tyreChoices } from "../weatherUi";
import type { RaceApi } from "./Play";
import { Tyre } from "./Tyre";

export function PitControls({ view, race, humanCars, disabled }: { view: View; race: RaceApi; humanCars: string[]; disabled: boolean }) {
  const info = race.state.info;
  const names = useNames();
  const who = (id: string) => names.surname(id);
  return (
    <section className="pit">
      {humanCars.map((id) => {
        const car = view.cars.find((c) => c.id === id);
        const own = view.own[id];
        if (!car || !own) return null;
        const out = car.status === "RETIRED" || car.status === "FINISHED";
        const loss = tyreLoss(own.est_tyre_loss_s);
        return (
          <div key={id} className="car-card">
            <h3>
              {names.driver(id)} <span className="muted">P{car.position}</span> <Tyre compound={car.compound} /> {plural(car.tyre_age, "lap")}
            </h3>
            <div className="loss" title="Estimated lap time lost to tyre wear (noisy)">
              <div className="loss-bar" style={{ width: `${Math.min(100, (loss / 3) * 100)}%` }} />
              <span>tyres {loss >= 0.05 ? "+" : ""}{loss.toFixed(1)} s/lap</span>
            </div>
            {(view.session === "RACING" || view.session === "SC" || view.session === "VSC") && !out && !own.box_call && (() => {
              const loss = info ? pitLossNow(info, view.session) : undefined;
              const r = loss === undefined ? null : rejoinAfterStop(view.cars, id, loss, info?.traffic_window_s ?? 1);
              const d = info?.pit_call_deadline_frac === undefined ? null : callDeadline(car.lap_frac, info.pit_call_deadline_frac, car.last_lap_s);
              return (
                <>
                  {r && (
                    <p className="rejoin">
                      Stop now{view.session === "RACING" ? "" : view.session === "VSC" ? " under the VSC" : " under the safety car"}: rejoin <strong>P{r.position}</strong>
                      {r.ahead && <>, {r.behindAheadS!.toFixed(1)} s behind {who(r.ahead)}</>}
                      {r.behind && <>, {r.aheadOfBehindS!.toFixed(1)} s ahead of {who(r.behind)}</>}
                    </p>
                  )}
                  {d && <p className={d.open ? "small" : "small warn"}>{d.open ? `Call this lap: ${d.seconds === null ? "still time" : `${Math.ceil(d.seconds)} s left`}` : "Too late for this lap: a call is for the next one"}</p>}
                </>
              );
            })()}
            {info && (() => {
              const warn = ruleWarning(view, car, info.total_laps, !!own.box_call);
              return warn ? <p className="small warn rule-warn">{warn}</p> : null;
            })()}
            {view.session === "RED" && <p className="muted small">Red flag: a tyre change costs no time, and applies at the restart.</p>}
            {own.box_call ? (
              <p>
                {view.session === "RED" ? "Tyre change called" : "Box called"}: <Tyre compound={own.box_call.compound} big /> <strong>{own.box_call.compound.toLowerCase()}</strong>{" "}
                <button disabled={disabled || out} onClick={() => race.cancelBox(id)}>
                  Cancel
                </button>
              </p>
            ) : (
              <div className="tyre-choices">
                <span className="small muted">Call a <Gloss term="box">box</Gloss>:</span>
                {tyreChoices(view).map((t) => (
                  <button key={t} disabled={disabled || out || (car.sets_remaining[t] ?? 0) <= 0} onClick={() => race.callBox(id, t)}>
                    Box <Tyre compound={t} /> <span className="muted">({car.sets_remaining[t] ?? 0})</span>
                  </button>
                ))}
              </div>
            )}
            {!out && <BoxOpposite view={view} race={race} id={id} disabled={disabled} />}
            {out && <p className="muted small">{car.status === "RETIRED" ? "Out of the race." : "Finished."}</p>}
          </div>
        );
      })}
    </section>
  );
}

/** "Box opposite COV": the driver decides at the pit entry, and does what the rival ahead did not. */
function BoxOpposite({ view, race, id, disabled }: { view: View; race: RaceApi; id: string; disabled: boolean }) {
  const names = useNames();
  const car = view.cars.find((c) => c.id === id)!;
  const own = view.own[id];
  const [pick, setPick] = useState("");
  const ahead = rivalsAhead(view, id);
  if (own.order) {
    return (
      <p className="small">
        Watching <strong>{names.surname(own.order.target)}</strong>. At our pit entry: if {names.surname(own.order.target)} has stayed out we box for{" "}
        {own.order.compound.toLowerCase()}, if {names.surname(own.order.target)} has boxed we stay out.{" "}
        <button disabled={disabled} onClick={() => race.cancelBox(id)}>Cancel</button>
      </p>
    );
  }
  if (!ahead.length || own.box_call || view.session === "RED") return null;
  const target = ahead.find((r) => r.c.id === pick)?.c.id ?? ahead[0].c.id;
  return (
    <div className="opposite">
      <label className="small">
        <Gloss term="box opposite">Box opposite</Gloss>
        <select value={target} onChange={(e) => setPick(e.target.value)}>
          {ahead.map((r) => (
            <option key={r.c.id} value={r.c.id}>P{r.c.position} {names.surname(r.c.id)}, {r.gap.toFixed(1)} s ahead</option>
          ))}
        </select>
      </label>
      <div className="tyre-choices">
        <span className="small muted">Box opposite, on</span>
        {DRY_COMPOUNDS.map((t) => (
          <button key={t} disabled={disabled || (car.sets_remaining[t] ?? 0) <= 0} onClick={() => race.boxOpposite(id, target, t)}>
            <Tyre compound={t} />
          </button>
        ))}
      </div>
    </div>
  );
}
