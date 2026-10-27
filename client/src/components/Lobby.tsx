import { useState } from "react";
import { usePacks } from "../hooks";
import { emptyResolver } from "../packs/browser";
import { teamLabel } from "../packs/identity";
import type { Resolver } from "../packs/resolve";
import type { RaceApi } from "./Play";

/** The multiplayer lobby on the grid: the code to share, who has joined, and (for the host) the speed before the start. */
export function Lobby({ race, host }: { race: RaceApi; host: boolean }) {
  const { info, clock } = race.state;
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  const [copied, setCopied] = useState(false);
  if (!info) return null;
  const players = clock?.players ?? info.players ?? [];
  const copy = () => {
    void navigator.clipboard?.writeText(info.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <section className="lobby">
      <div className="lobby-code">
        <span className="muted">Game code, give it to your friends</span>
        <strong>{info.id.toUpperCase()}</strong>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <ul className="lobby-players">
        {players.map((p) => (
          <li key={p.team} className={p.connected ? "" : "away"}>
            <span className="swatch" style={{ background: resolver.team(p.team).colours.primary }} />
            <strong>{p.name}</strong>
            <span className="muted">{teamLabel(p.team, resolver)}</span>
            {p.host && <em>host</em>}
            {!p.connected && <span className="muted small">not connected</span>}
          </li>
        ))}
      </ul>
      {host && clock && (
        <div className="lobby-host">
          <div className="seg" role="radiogroup" aria-label="Speed">
            {[1, 2, 5, 10].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={clock.speed === s} className={clock.speed === s ? "chosen" : ""} onClick={() => race.setSpeed(s)}>{s}x</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
