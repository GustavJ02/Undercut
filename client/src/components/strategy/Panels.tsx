import { Gloss } from "../Gloss";
import { plural } from "../../format";
import { MIN_STINT_LAPS, OUT_LAP_PENALTY_S, pitLossNow, rejoinAfterStop, stopStillPossible, rivalLoss, stintSlope, stintsOf, tyreLoss, undercut, wearPrior } from "../../strategy/analysis";
import type { LapTable, RaceInfo, TyreGuide, View } from "../../types";

const s1 = (x: number) => x.toFixed(1);
const s2 = (x: number) => x.toFixed(2);

/** Where the car would rejoin after a stop now, from the gaps and the green-flag pit loss. */
export function PitWindow({ view, info, car, name }: { view: View; info: RaceInfo; car: string; name: (id: string) => string }) {
  const loss = pitLossNow(info, view.session), win = info.traffic_window_s ?? 1;
  if (loss === undefined) return <section className="card"><h3>Pit window</h3><p className="muted">The server did not send the pit loss.</p></section>;
  const row = view.cars.find((c) => c.id === car);
  if (row && !stopStillPossible(row, info.total_laps, info.pit_call_deadline_frac)) return <section className="card"><h3>Pit window, {name(car)}</h3><p className="muted">Too few laps left for a stop.</p></section>;
  const r = rejoinAfterStop(view.cars, car, loss, win);
  return (
    <section className="card">
      <h3>Pit window, {name(car)}</h3>
      {!r ? <p className="muted">No time gap to the leader yet (lapped, or the leader has finished).</p> : (
        <>
          <p className="big">Rejoin P{r.position}</p>
          <p>
            {r.ahead ? <>{s1(r.behindAheadS!)} s behind {name(r.ahead)}</> : <>in the lead</>}
            {r.behind ? <>, {s1(r.aheadOfBehindS!)} s clear of {name(r.behind)}</> : null}
          </p>
          {r.inTraffic && <p className="warn">⚠ Within {s1(win)} s of {name(r.ahead!)}: dirty air would cost pace.</p>}
          <p className="muted small">{view.session === "SC" ? "Safety-car" : view.session === "VSC" ? "VSC" : "Green-flag"} <Gloss term="pit loss">pit loss</Gloss> {s1(loss)} s.{view.session === "RACING" && info.pit_loss_sc_s !== undefined ? ` Under a safety car it is ${s1(info.pit_loss_sc_s)} s.` : ""}</p>
        </>
      )}
    </section>
  );
}

/** Undercut on the car in front and the threat from the car behind, from public lap times and the team's own tyre estimate. */
export function Undercuts({ view, laps, car, fuel, name, guide }: { view: View; laps: LapTable; car: string; fuel: number; name: (id: string) => string; guide?: TyreGuide }) {
  const row = view.cars.find((c) => c.id === car);
  if (!row) return null;
  const order = [...view.cars].sort((a, b) => a.position - b.position);
  const i = order.findIndex((c) => c.id === car);
  const front = order[i - 1], back = order[i + 1];
  const est = view.own[car]?.est_tyre_loss_s;
  const own = est === undefined ? null : tyreLoss(est);
  const slopeOf = (id: string) => {
    const st = stintsOf(laps[id] ?? []);
    const last = st[st.length - 1];
    return last ? stintSlope(last.clean, fuel, true, wearPrior(guide, last.compound)) : null;
  };

  let attack: React.ReactNode = <p className="muted">You are leading.</p>;
  if (front) {
    const slope = slopeOf(front.id), loss = rivalLoss(slope, front.tyre_age);
    attack = front.interval_s === null || row.interval_s === null ? <p className="muted">No time gap to {name(front.id)}.</p>
      : loss === null ? <p className="muted">{name(front.id)} has fewer than {MIN_STINT_LAPS} clean laps on these tyres: no wear to read yet. Gap {s1(row.interval_s)} s.</p>
      : (() => {
        const u = undercut(row.interval_s, loss);
        return (
          <>
            <p><b>{name(front.id)}</b>, {s1(row.interval_s)} s ahead. {loss > 0
              ? <>Their tyres cost about {s2(loss)} s a lap <span className="muted small">({s2(slope!.perLap)} s/lap × {plural(front.tyre_age, "lap")}, {slope!.prior ? (slope!.n ? `tyre guide and ${plural(slope!.n, "clean lap")}` : "tyre guide") : `from ${plural(slope!.n, "lap")}`})</span>.</>
              : <>Their tyres show no wear <span className="muted small">(lap times {s2(-slope!.perLap)} s/lap faster over {plural(slope!.n, "lap")})</span>.</>}</p>
            <p className={u.laps ? "good" : "muted"}>{u.laps ? `✓ An undercut gets you ahead if they stay out ${u.laps} lap${u.laps > 1 ? "s" : ""}.` : `✗ Not within 3 laps: ${s1(-u.marginAtMax)} s short.`}</p>
          </>
        );
      })();
  }
  let defend: React.ReactNode = <p className="muted">Nobody behind.</p>;
  if (back) {
    defend = back.interval_s === null || own === null ? <p className="muted">No time gap to {name(back.id)}.</p> : (() => {
      const u = undercut(back.interval_s, own);
      return (
        <>
          <p><b>{name(back.id)}</b>, {s1(back.interval_s)} s behind. Your tyres cost about {s2(own)} s a lap <span className="muted small">(your engineers' estimate)</span>.</p>
          <p className={u.laps ? "warn" : "muted"}>{u.laps ? `⚠ They could undercut you if you stay out ${u.laps} lap${u.laps > 1 ? "s" : ""}.` : "They cannot undercut you within 3 laps."}</p>
        </>
      );
    })();
  }
  return (
    <section className="card">
      <h3><Gloss term="undercut">Undercut</Gloss>, {name(car)}</h3>
      {attack}
      <h4>Their undercut on you</h4>
      {defend}
      <p className="muted small">Estimates. The out lap is assumed to cost {OUT_LAP_PENALTY_S} s and the rival to stop after the lap shown. The <Gloss term="overcut">overcut</Gloss>, staying out while they pit, is not estimated.</p>
    </section>
  );
}

export interface OwnPoint { lap: number; est: number; dirty: number; damage: number }

/** The team's own telemetry for a car: tyre loss estimate over the laps, and dirty air and damage now. */
export function OwnTelemetry({ view, car, history, name }: { view: View; car: string; history: OwnPoint[]; name: (id: string) => string }) {
  const own = view.own[car];
  if (!own) return null;
  const W = 300, H = 56;
  const pts = history;
  const max = Math.max(...pts.map((p) => p.est), 0.2);
  const xs = (i: number) => (pts.length < 2 ? W : (i / (pts.length - 1)) * W);
  return (
    <section className="card">
      <h3>Own car, {name(car)}</h3>
      <div className="telemetry">
        <div><span className="muted">Tyre loss (estimate)</span><b>{s2(tyreLoss(own.est_tyre_loss_s))} s</b></div>
        <div><span className="muted"><Gloss term="dirty air">Dirty air</Gloss> now</span><b>{s2(own.dirty_air_loss_s ?? 0)} s</b></div>
        <div><span className="muted">Damage</span><b>{s2(own.damage_loss_s ?? 0)} s</b></div>
      </div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Tyre loss estimate over the laps">
          <path d={pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${(H - 4 - (p.est / max) * (H - 8)).toFixed(1)}`).join("")} className="chart-line" style={{ ["--c" as string]: "var(--viz-1)" }} />
        </svg>
      )}
    </section>
  );
}
