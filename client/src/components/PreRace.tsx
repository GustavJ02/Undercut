import { GlossaryScope } from "./Gloss";
import { RULE_TEXT } from "../rules";
import { useState } from "react";
import { useMyColour, useNames } from "../hooks";
import { type Compound } from "../types";
import { tyreChoices } from "../weatherUi";
import { WeatherPanel } from "./WeatherPanel";
import type { RaceApi } from "./Play";
import { Tyre } from "./Tyre";
import { Lobby } from "./Lobby";
import { TyreGuide } from "./TyreGuide";
import { CircuitStats, TrackPicture, circuitMeta, circuitName } from "./setup/circuits";

export function PreRace({ race, onLeave }: { race: RaceApi; onLeave: () => void }) {
  const { view, info } = race.state;
  const myColour = useMyColour(race.state.info?.human_team);
  const names = useNames();
  const [chosen, setChosen] = useState<Record<string, Compound>>({});
  if (!view || !info) return null;
  const multi = !!info.multiplayer;
  const host = !multi || info.host === race.team;
  const mine = view.cars.filter((c) => info.human_cars.includes(c.id));
  const pick = (car: string, c: Compound) => {
    setChosen({ ...chosen, [car]: c });
    race.setStartTyres(car, c);
  };
  return (
    <GlossaryScope>
    <main className="prerace" style={{ ["--mine" as string]: myColour }}>
      <div className="circuit-detail">
        <div className="circuit-title">
          {circuitMeta(info.circuit).flag}
          <div>
            <h2>{names.circuit(info.circuit, circuitName(info.circuit))}</h2>
            <span className="muted">{[circuitMeta(info.circuit).place, circuitMeta(info.circuit).country].filter(Boolean).join(", ")}</span>
          </div>
        </div>
        <div className="circuit-body">
          <TrackPicture circuit={info.circuit} />
          <CircuitStats laps={info.total_laps} lapLengthM={info.lap_length_m} corners={info.corners?.length} scRate={info.sc_rate_per_lap} />
        </div>
      </div>
      {multi && <Lobby race={race} host={host} />}
      <WeatherPanel view={view} />
      <p className="muted">Choose the starting tyres. Rivals' sets are public, their plans are not.</p>
      <p className="muted small rule-note"><strong>Stop rule:</strong> {RULE_TEXT}</p>
      <TyreGuide info={info} pitLoss={info.pit_loss_s ?? 22} />
      <div className="grid-and-tyres">
        <section>
          <h3>Starting grid</h3>
          <ol className="grid-list">
            {view.cars.map((c) => (
              <li key={c.id} className={info.human_cars.includes(c.id) ? "mine" : ""}>
                <span className="drv">{names.driverShort(c.id)}</span> {names.driver(c.id)}
              </li>
            ))}
          </ol>
        </section>
        <section>
          {mine.map((c) => (
            <div key={c.id} className="car-card">
              <h3>
                {names.driver(c.id)} <span className="muted">P{c.position}</span>
              </h3>
              <div className="tyre-choices">
                {tyreChoices(view).map((t) => (
                  <button key={t} className={(chosen[c.id] ?? "") === t ? "chosen" : ""} disabled={(c.sets_remaining[t] ?? 0) <= 0} onClick={() => pick(c.id, t)}>
                    <Tyre compound={t} /> {t.toLowerCase()} <span className="muted">({c.sets_remaining[t] ?? 0} sets)</span>
                  </button>
                ))}
              </div>
              <p className="muted small">{chosen[c.id] ? `Starting on ${chosen[c.id].toLowerCase()}.` : "No choice yet: the engineers will pick the usual medium."}</p>
            </div>
          ))}
        </section>
      </div>
      <div className="actions">
        {host ? (
          <button className="primary" onClick={race.start} disabled={race.starting}>
            {race.starting ? "Lights…" : "Lights out"}
          </button>
        ) : (
          <p className="muted">Waiting for the host to start the race.</p>
        )}
        <button className="link" onClick={onLeave}>
          {multi ? "Leave the game" : "Back to setup"}
        </button>
      </div>
    </main>
    </GlossaryScope>
  );
}
