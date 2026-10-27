import { useEffect, useRef, useState } from "react";
import type { Session } from "../App";
import { getGame, getOptions, joinGame } from "../api";
import { usePacks } from "../hooks";
import { emptyResolver } from "../packs/browser";
import { teamLabel } from "../packs/identity";
import type { Resolver } from "../packs/resolve";
import type { Options, Player } from "../types";
import { circuitName } from "./setup/circuits";

/** Join a game: the code first, then a free team from the ones the host's game still has. */
export function JoinGame({ onStart, onBack }: { onStart: (s: Session) => void; onBack: () => void }) {
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  const [options, setOptions] = useState<Options | null>(null);
  const [code, setCode] = useState("");
  const [game, setGame] = useState<{ id: string; players: Player[]; circuit: string; total_laps: number } | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [name, setName] = useState(() => localStorage.getItem("undercut.name") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    getOptions().then(setOptions).catch((e) => setError(String(e)));
  }, []);

  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await getGame(code);
      setGame(g);
      setTeam(null);
    } catch (e) {
      setGame(null);
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const join = async () => {
    if (!game || !team) return;
    setBusy(true);
    try {
      try { localStorage.setItem("undercut.name", name.trim()); } catch { /* not remembered in a private window */ }
      const seat = await joinGame(game.id, team, name.trim());
      onStart({ roomId: seat.id, team: seat.team, seat: seat.seat, multiplayer: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      void look(); // the free teams may have changed
    }
  };

  const taken = new Set(game?.players.map((p) => p.team));
  const ready = code.trim().length >= 4;
  return (
    <main className="wiz join">
      <header className="wiz-head">
        <h1>Join game</h1>
      </header>
      <div className="wiz-body join-body">
        <form className="join-code" onSubmit={(e) => { e.preventDefault(); if (ready) void look(); }}>
          <label>
            Game code
            <input ref={input} value={code} maxLength={8} autoComplete="off" spellCheck={false} placeholder="ABCDE" onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setGame(null); }} />
          </label>
          <button type="submit" className="primary" disabled={!ready || busy}>Find game</button>
        </form>
        {game && options && (
          <section className="join-teams">
            <h3>
              {(resolver.circuitName(game.circuit) ?? circuitName(game.circuit))}, {game.total_laps} laps. {game.players.length} {game.players.length === 1 ? "player" : "players"} so far: {game.players.map((p) => p.name).join(", ")}
            </h3>
            <label className="name-field">
              Your name
              <input value={name} maxLength={20} placeholder="Shown to the other players" onChange={(e) => setName(e.target.value)} />
            </label>
            <h3>Pick a free team</h3>
            <div className="team-grid" role="listbox" aria-label="Free teams">
              {options.teams.map((t) => {
                const c = resolver.team(t.id).colours;
                const used = taken.has(t.id);
                return (
                  <button key={t.id} type="button" role="option" aria-selected={team === t.id} disabled={used} className={team === t.id ? "chosen" : ""} onClick={() => setTeam(t.id)} style={{ ["--c1" as string]: c.primary, ["--c2" as string]: c.accent }}>
                    <span className="swatch" />
                    <span>
                      <strong>{teamLabel(t.id, resolver)}</strong>
                      <span className="muted small">{used ? `taken by ${game.players.find((p) => p.team === t.id)?.name}` : t.drivers.map((d) => d.name.split(" ").slice(-1)[0]).join(", ")}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <footer className="wiz-foot">
        <div>{error && <p className="error">{error}</p>}</div>
        <div className="wiz-nav">
          <button type="button" onClick={onBack}>Back</button>
          <button type="button" className="primary" disabled={!game || !team || busy} onClick={join}>Join the game</button>
        </div>
      </footer>
    </main>
  );
}
