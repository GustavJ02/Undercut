import { GlossaryScope } from "./Gloss";
import { plural } from "../format";
import { useEffect, useMemo, useRef, useState } from "react";
import { clockText } from "../format";
import { chipOrder, stintSlope, stintsOf, tyreLoss, wearPrior, MIN_STINT_LAPS } from "../strategy/analysis";
import { usePacks } from "../hooks";
import { emptyResolver } from "../packs/browser";
import { driverShortLabel, driverSurname } from "../packs/identity";
import type { Resolver } from "../packs/resolve";
import { Monitor } from "./Monitor";
import type { RaceApi } from "./Play";
import { Tyre } from "./Tyre";
import { LapChart, type Series } from "./strategy/LapChart";
import { OwnTelemetry, PitWindow, Undercuts, type OwnPoint } from "./strategy/Panels";

const SLOTS = 6;
const MAX_LAPS_SHOWN = 90;

/** Own telemetry over the laps: the estimate arrives as a state, so each lap's latest value is kept as the race goes on. */
function useOwnHistory(race: RaceApi): Record<string, OwnPoint[]> {
  const { view } = race.state;
  const hist = useRef<Record<string, OwnPoint[]>>({});
  const [, bump] = useState(0);
  const lap = view?.race_lap;
  useEffect(() => {
    if (!view) return;
    let changed = false;
    for (const [id, o] of Object.entries(view.own)) {
      const list = (hist.current[id] ??= []);
      const point = { lap: view.race_lap, est: tyreLoss(o.est_tyre_loss_s), dirty: o.dirty_air_loss_s ?? 0, damage: o.damage_loss_s ?? 0 };
      if (list.length && list[list.length - 1].lap === point.lap) list[list.length - 1] = point;
      else { list.push(point); changed = true; }
      if (list.length > MAX_LAPS_SHOWN) list.shift();
    }
    if (changed) bump((n) => n + 1);
    // the history belongs to the race: a new view of the same lap only replaces the latest point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lap, view?.own]);
  return hist.current;
}

/** The screen to the right of the wall. It is on a different part of the desk: from the wall you cannot see it, and from here you cannot
 * see the timing tower, the radio or the pit calls. */
export function Strategy({ race, look, setLook, focusLap = null }: { race: RaceApi; look: "wall" | "strategy"; setLook: (l: "wall" | "strategy") => void; focusLap?: { lap: number; car: string; n: number } | null }) {
  const { view, info, laps } = race.state;
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  const history = useOwnHistory(race);
  const [corrected, setCorrected] = useState(true);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const mine = info?.human_cars ?? [];
  const chosen = picked ?? mine;
  // a decision chosen in the debrief: its car is in the chart, and its lap is marked
  useEffect(() => {
    if (!focusLap) return;
    setPicked((cur) => {
      const list = cur ?? mine;
      return list.includes(focusLap.car) ? list : [...list.slice(0, SLOTS - 1), focusLap.car];
    });
    setFocus(focusLap.car);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLap?.n]);
  const name = (id: string) => driverSurname(id, resolver);
  const fuel = info?.fuel_s_per_lap ?? 0.05;
  const slotOf = (id: string) => chosen.indexOf(id);

  const series: Series[] = useMemo(
    () => chosen.slice(0, SLOTS).map((id, i) => ({ id, label: driverShortLabel(id, resolver), colour: `var(--viz-${i + 1})`, rows: laps[id] ?? [], own: mine.includes(id) })),
    [chosen, laps, mine],
  );
  if (!view || !info) return null;
  const toggle = (id: string) => setPicked((cur) => {
    const list = cur ?? mine;
    if (list.includes(id)) return list.filter((x) => x !== id);
    return list.length >= SLOTS ? list : [...list, id];
  });
  const ownFocus = focus && mine.includes(focus) ? focus : mine[0];
  // the pit window and the undercut panels predict a stop in a race that is still on: after the flag, or once the car is out, they go
  const focusRow = view?.cars.find((c) => c.id === ownFocus);
  const live = view?.session !== "FINISHED" && focusRow?.status !== "FINISHED" && focusRow?.status !== "RETIRED";
  const order = chipOrder(view.cars, mine);

  return (
    <GlossaryScope>
    <Monitor name="strategy" className="monitor-strategy">
      <div className="strategy" {...(look === "wall" ? ({ inert: "" } as object) : {})}>
        <header className="strategy-head">
          <button type="button" className="primary" onClick={() => setLook("wall")} title="Back to the pit wall (left arrow)">◂ Pit wall</button>
          <strong>Strategy</strong>
          <span className="muted">Lap {view.race_lap}/{view.total_laps} · {clockText(view.time_s)}</span>
          <span className="spacer" />
          <label className="check"><input type="checkbox" checked={corrected} onChange={(e) => setCorrected(e.target.checked)} /> Fuel corrected</label>
        </header>
        <div className="strategy-body">
          <div className="strategy-left">
            <div className="chips" role="group" aria-label="Cars in the chart">
              {order.map((c) => {
                const slot = slotOf(c.id);
                return (
                  <button key={c.id} type="button" aria-pressed={slot >= 0} className={`chip ${slot >= 0 ? "on" : ""} ${mine.includes(c.id) ? "own" : ""}`}
                    style={slot >= 0 ? ({ ["--c" as string]: `var(--viz-${slot + 1})` }) : undefined} onClick={() => toggle(c.id)} title={name(c.id)}>
                    {slot >= 0 && <span className="swatch" />}{driverShortLabel(c.id, resolver)}
                  </button>
                );
              })}
            </div>
            <LapChart series={series} fuel={fuel} corrected={corrected} laps={view.race_lap} guide={info?.tyre_guide} markLap={focusLap?.lap ?? null} />
            <table className="stints">
              <thead><tr><th>Car</th><th>Stint</th><th>Tyre</th><th>Laps</th><th>Wear, s per lap of age</th></tr></thead>
              <tbody>
                {series.flatMap((s) => stintsOf(s.rows).map((st) => {
                  const sl = stintSlope(st.clean, fuel, corrected, wearPrior(info?.tyre_guide, st.compound));
                  return (
                    <tr key={`${s.id}${st.index}`}>
                      <td><span className={`swatch${s.own ? " own" : ""}`} style={{ background: s.colour }} /> {name(s.id)}</td>
                      <td>{st.index}</td>
                      <td><Tyre compound={st.compound as never} /></td>
                      <td>{st.laps.length}</td>
                      <td>{sl ? <><b>{sl.perLap >= 0 ? "+" : ""}{sl.perLap.toFixed(3)}</b> <span className="muted">± {sl.sd.toFixed(3)}, {sl.n >= MIN_STINT_LAPS ? `from ${plural(sl.n, "lap")}` : sl.n ? `tyre guide and ${plural(sl.n, "lap")}` : "tyre guide"}</span></> : <span className="muted">too few clean laps</span>}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
          <div className="strategy-right">
            {mine.length > 1 && (
              <div className="seg" role="radiogroup" aria-label="Your car">
                {mine.map((id) => <button key={id} type="button" role="radio" aria-checked={ownFocus === id} className={ownFocus === id ? "chosen" : ""} onClick={() => setFocus(id)}>{name(id)}</button>)}
              </div>
            )}
            {ownFocus && live && <PitWindow view={view} info={info} car={ownFocus} name={name} />}
            {ownFocus && live && <Undercuts view={view} laps={laps} car={ownFocus} fuel={fuel} name={name} guide={info?.tyre_guide} />}
            {ownFocus && <OwnTelemetry view={view} car={ownFocus} history={history[ownFocus] ?? []} name={name} />}
          </div>
        </div>
      </div>
    </Monitor>
    </GlossaryScope>
  );
}
