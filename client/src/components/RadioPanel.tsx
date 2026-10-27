import { useNames, useStickToBottom } from "../hooks";
import type { RaceApi } from "./Play";
import { RADIO_TOPICS, type RadioLine } from "../types";

/** A driver's request waiting for an answer (a pit call, a swap). Shown wherever the player is looking, because it expires. */
export function RadioRequests({ race }: { race: RaceApi }) {
  const { view, requests } = race.state;
  const open = requests.filter((r) => r.request && (!view || view.time_s < r.request.expires));
  if (!open.length) return null;
  return (
    <section className="radio-requests" aria-label="Driver requests">
      {open.map((r) => (
        <div key={r.id} className="radio-request">
          <p>
            <strong>{r.speaker}:</strong> {r.message}
          </p>
          <p className="muted small">{r.request!.label}</p>
          <div className="swap-row">
            <button className="primary" onClick={() => race.answerRadio(r.id, "yes")}>
              Accept
            </button>
            <button onClick={() => race.answerRadio(r.id, "no")}>Decline</button>
          </div>
        </div>
      ))}
    </section>
  );
}

const line = (l: RadioLine) => (
  <li key={l.id} className={l.from === "driver" ? "radio-driver" : "radio-engineer"}>
    <strong>{l.speaker}</strong> {l.message}
  </li>
);

/** Ask a driver something, and read the transcript of the team radio, oldest at the top so a reply sits under its question. */
export function RadioPanel({ race }: { race: RaceApi }) {
  const { info, view, radio } = race.state;
  const names = useNames();
  const stick = useStickToBottom<HTMLUListElement>(radio.length);
  if (!info || !view) return null;
  const racing = view.session !== "GRID" && view.session !== "FINISHED";
  return (
    <section className="radio" aria-label="Team radio">
      {info.human_cars.map((id) => {
        const car = view.cars.find((c) => c.id === id);
        const out = !car || car.status === "RETIRED" || car.status === "FINISHED";
        return (
          <div key={id} className="radio-ask">
            <span className="radio-car">{names.driverShort(id)}</span>
            {RADIO_TOPICS.map((t) => (
              <button key={t.topic} disabled={!racing || out} onClick={() => race.askRadio(id, t.topic)}>
                {t.label}
              </button>
            ))}
          </div>
        );
      })}
      <ul className="radio-log" ref={stick.ref} onScroll={stick.onScroll}>{radio.map(line)}</ul>
      {!radio.length && <p className="muted small">Nothing on the radio yet. Ask a driver about tyres, weather, traffic, the car or pace.</p>}
    </section>
  );
}
