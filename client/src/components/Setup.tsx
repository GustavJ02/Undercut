import { LegalFooter } from "./LegalFooter";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "../App";
import { createGame, createRace, getOptions } from "../api";
import { useNames, usePacks } from "../hooks";
import { emptyResolver } from "../packs/browser";
import { driverLabel, driverSurname, teamLabel } from "../packs/identity";
import type { Resolver } from "../packs/resolve";
import type { Options } from "../types";
import { CarShowroom, type Look } from "./setup/CarShowroom";
import { Chaos, ChaosPanel, REALISTIC, chaosRequest } from "./setup/ChaosPanel";
import { CircuitStats, TrackPicture, byName, circuitMeta, circuitName } from "./setup/circuits";
import { DriverCard } from "./setup/DriverCard";

const STEPS = ["Team", "Circuit", "Race"] as const;
const WEATHER = [
  { id: "realistic", label: "Realistic", note: "Random, at plausible rates" },
  { id: "dry", label: "Dry", note: "Sun all race" },
  { id: "wet_start", label: "Wet start", note: "Damp track, drying out" },
  { id: "rain_during", label: "Rain later", note: "Dry start, rain during the race" },
];

/** Not while typing or choosing in a field: arrows there belong to the field. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA");

/** The start flow: pick a team and how many cars to run, pick the circuit, then set up the race. Everything is chosen by id; names and looks
 * come from the active pack. */
export function Setup({ onStart, mode = "solo", onBack }: { onStart: (s: Session) => void; mode?: "solo" | "create"; onBack?: () => void }) {
  const create = mode === "create";
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  const [options, setOptions] = useState<Options | null>(null);
  const [step, setStep] = useState(0);
  const [team, setTeam] = useState("");
  const [circuit, setCircuit] = useState("");
  const [cars, setCars] = useState(2);
  const [weather, setWeather] = useState("realistic");
  const [short, setShort] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pause, setPause] = useState(true);
  const [chaos, setChaos] = useState<Chaos>({ on: false, values: { ...REALISTIC } });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem("undercut.name") ?? "");

  useEffect(() => {
    getOptions()
      .then((o) => {
        setOptions(o);
        setTeam(o.teams[0].id);
        setCircuit(byName(Object.keys(o.circuits))[0]);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const teams = options?.teams ?? [];
  const circuits = useMemo(() => byName(Object.keys(options?.circuits ?? {})), [options]);
  const move = useCallback(
    (d: number) => {
      if (step === 0 && teams.length) setTeam((t) => teams[(teams.findIndex((x) => x.id === t) + d + teams.length) % teams.length].id);
      if (step === 1 && circuits.length) setCircuit((c) => circuits[(circuits.indexOf(c) + d + circuits.length) % circuits.length]);
    },
    [step, teams, circuits],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [move]);

  const t = teams.find((x) => x.id === team) ?? teams[0];
  const look: Look | null = useMemo(() => {
    if (!t) return null;
    const ident = resolver.team(t.id);
    return { colours: ident.colours, pattern: ident.livery.pattern, helmet: resolver.driver(t.drivers[0].id).helmet.primary };
  }, [resolver, t]);
  if (!options || !t || !look) return <main className="wiz">{error ?? "Loading…"}</main>;
  const ident = resolver.team(t.id);
  const laps = short ? 15 : options.circuits[circuit];
  const go = async () => {
    setBusy(true);
    try {
      const req = { team, circuit, cars_controlled: cars, speed, pause_allowed: pause, weather, laps: short ? 15 : undefined, incident_multipliers: chaosRequest(chaos) };
      if (create) {
        try { localStorage.setItem("undercut.name", name.trim()); } catch { /* a private window: the name is simply not remembered */ }
        const seat = await createGame({ ...req, name: name.trim() || undefined });
        onStart({ roomId: seat.id, team: seat.team, seat: seat.seat, multiplayer: true });
      } else {
        const room = await createRace(req);
        onStart({ roomId: room.id, team });
      }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <main className="wiz">
      <header className="wiz-head">
        <h1>Undercut</h1>
        <ol className="wiz-steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" className={i === step ? "now" : i < step ? "done" : ""} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                <span>{i + 1}</span> {s}
              </button>
            </li>
          ))}
        </ol>
      </header>

      <div className="wiz-body">
        {step === 0 && (
          <div className="team-step" onWheel={(e) => { if (Math.abs(e.deltaY) > 20 && !(e.target as HTMLElement).closest("select,input")) move(e.deltaY > 0 ? 1 : -1); }}>
            <div className="team-stage">
              <button type="button" className="arrow" aria-label="Previous team" onClick={() => move(-1)}>‹</button>
              <div className="team-hero">
                <CarShowroom look={look} />
                <div className="team-title" style={{ borderColor: ident.colours.primary }}>
                  <h2>{teamLabel(t.id, resolver)}</h2>
                  <span className="muted">{teams.findIndex((x) => x.id === t.id) + 1} of {teams.length}, drag the car to turn it</span>
                </div>
              </div>
              <button type="button" className="arrow" aria-label="Next team" onClick={() => move(1)}>›</button>
            </div>
            <div className="team-side">
              <h3>Your drivers</h3>
              <div className="drivers">
                {t.drivers.map((d, i) => (
                  <DriverCard key={d.id} name={driverLabel(d.id, resolver)} driver={resolver.driver(d.id)} team={ident} selected={cars === 2 || i === 0} />
                ))}
              </div>
              {create && (
                <label className="name-field">
                  Your name
                  <input value={name} maxLength={20} placeholder="Shown to the other players" onChange={(e) => setName(e.target.value)} />
                </label>
              )}
              <h3>Cars you control</h3>
              <div className="seg" role="radiogroup" aria-label="Cars you control">
                <button type="button" role="radio" aria-checked={cars === 2} className={cars === 2 ? "chosen" : ""} onClick={() => setCars(2)}>Both drivers</button>
                <button type="button" role="radio" aria-checked={cars === 1} className={cars === 1 ? "chosen" : ""} onClick={() => setCars(1)}>
                  Only {driverSurname(t.drivers[0].id, resolver)}
                </button>
              </div>
              <p className="muted small">{cars === 2 ? "You call the stops for both cars." : "Your team mate runs on the AI."}</p>
            </div>
            <div className="team-dots" role="listbox" aria-label="Teams">
              {teams.map((x) => {
                const c = resolver.team(x.id).colours;
                return (
                  <button key={x.id} type="button" role="option" aria-selected={x.id === t.id} className={x.id === t.id ? "chosen" : ""} onClick={() => setTeam(x.id)} title={teamLabel(x.id, resolver)} style={{ ["--c1" as string]: c.primary, ["--c2" as string]: c.accent }}>
                    <span className="chip-label">{resolver.team(x.id).short}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="circuit-step">
            <div className="circuit-list" role="listbox" aria-label="Circuits">
              {circuits.map((c) => {
                const m = circuitMeta(c);
                return (
                  <button key={c} type="button" role="option" aria-selected={c === circuit} className={c === circuit ? "chosen" : ""} onClick={() => setCircuit(c)} ref={c === circuit ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
                    {m.flag}
                    <span>
                      <strong>{(resolver.circuitName(c) ?? circuitName(c))}</strong>
                      <span className="muted">{m.country}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <CircuitDetail id={circuit} options={options} />
          </div>
        )}

        {step === 2 && (
          <div className="options-step">
            <section>
              <h3>Weather</h3>
              <div className="tiles" role="radiogroup" aria-label="Weather">
                {WEATHER.map((w) => (
                  <button key={w.id} type="button" role="radio" aria-checked={weather === w.id} className={weather === w.id ? "chosen" : ""} onClick={() => setWeather(w.id)}>
                    <strong>{w.label}</strong>
                    <span className="muted small">{w.note}</span>
                  </button>
                ))}
              </div>
              <h3>Race</h3>
              <div className="seg" role="radiogroup" aria-label="Race length">
                <button type="button" role="radio" aria-checked={!short} className={!short ? "chosen" : ""} onClick={() => setShort(false)}>Full distance ({options.circuits[circuit]} laps)</button>
                <button type="button" role="radio" aria-checked={short} className={short ? "chosen" : ""} onClick={() => setShort(true)}>Short race (15 laps)</button>
              </div>
              {create ? (
                <p className="muted small">In a multiplayer race nobody can pause. You choose the speed in the lobby, before the lights go out.</p>
              ) : (
                <>
                  <div className="seg" role="radiogroup" aria-label="Speed">
                    {options.speeds.map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? "chosen" : ""} onClick={() => setSpeed(s)}>{s}x</button>
                    ))}
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /> Allow pausing
                  </label>
                </>
              )}
            </section>
            <ChaosPanel chaos={chaos} onChange={setChaos} />
          </div>
        )}
      </div>

      <footer className="wiz-foot">
        <p className="muted small">
          {teamLabel(t.id, resolver)}, {(resolver.circuitName(circuit) ?? circuitName(circuit))}, {laps} laps{chaos.on ? ", chaos on" : ""}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="wiz-nav">
          {(step > 0 || onBack) && <button type="button" onClick={() => (step > 0 ? setStep(step - 1) : onBack?.())}>Back</button>}
          {step < STEPS.length - 1 ? (
            <button type="button" className="primary" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1]}</button>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={go}>{create ? "Create the game" : "Go to the grid"}</button>
          )}
        </div>
        <LegalFooter className="disclaimer" />
      </footer>
    </main>
  );
}

function CircuitDetail({ id, options }: { id: string; options: Options }) {
  const names = useNames();
  const m = circuitMeta(id);
  const laps = options.circuits[id];
  const info = options.circuit_info?.[id];
  return (
    <div className="circuit-detail">
      <div className="circuit-title">
        {m.flag}
        <div>
          <h2>{names.circuit(id, circuitName(id))}</h2>
          <span className="muted">{[m.place, m.country].filter(Boolean).join(", ")}</span>
        </div>
      </div>
      <div className="circuit-body">
        <TrackPicture circuit={id} />
        <CircuitStats laps={laps} lapLengthM={info?.lap_length_m} corners={info?.corners} scRate={info?.sc_rate_per_lap} />
      </div>
    </div>
  );
}
