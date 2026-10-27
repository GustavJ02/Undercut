import { LegalFooter } from "./LegalFooter";
import { useState } from "react";
import type { Session } from "../App";
import { lastSeat, saveSeat } from "../App";
import { getGame } from "../api";
import { JoinGame } from "./JoinGame";
import { Setup } from "./Setup";

type Screen = "mode" | "solo" | "multi" | "create" | "join";

/** What comes after the landing page: Singleplayer or Multiplayer, and under Multiplayer Create game or Join game. */
export function StartFlow({ onStart }: { onStart: (s: Session) => void }) {
  const [screen, setScreen] = useState<Screen>("mode");
  if (screen === "solo") return <Setup onStart={onStart} onBack={() => setScreen("mode")} />;
  if (screen === "create") return <Setup mode="create" onStart={onStart} onBack={() => setScreen("multi")} />;
  if (screen === "join") return <JoinGame onStart={onStart} onBack={() => setScreen("multi")} />;
  const multi = screen === "multi";
  const last = multi ? lastSeat() : null;
  const rejoin = () => {
    if (!last) return;
    getGame(last.roomId).then(() => onStart(last), () => { saveSeat(null); setScreen("mode"); });
  };
  return (
    <main className="wiz mode">
      <header className="wiz-head">
        <h1>Undercut</h1>
      </header>
      <div className="mode-choices">
        {multi ? (
          <>
            <button type="button" className="mode-card" onClick={() => setScreen("create")}>
              <strong>Create game</strong>
              <span>Pick your team and the race, then share the five letter code with your friends.</span>
            </button>
            <button type="button" className="mode-card" onClick={() => setScreen("join")}>
              <strong>Join game</strong>
              <span>Type the code a friend gave you and take a free team.</span>
            </button>
            {last && (
              <button type="button" className="mode-card" onClick={rejoin}>
                <strong>Rejoin game {last.roomId.toUpperCase()}</strong>
                <span>You left or lost the connection. Take your seat back; the AI has been driving your cars.</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="mode-card" onClick={() => setScreen("solo")}>
              <strong>Singleplayer</strong>
              <span>You are the strategist of one team. Pause, plan and replay the debrief.</span>
            </button>
            <button type="button" className="mode-card" onClick={() => setScreen("multi")}>
              <strong>Multiplayer</strong>
              <span>Race a friend or a whole paddock: each player runs a team, the clock never stops.</span>
            </button>
          </>
        )}
      </div>
      <footer className="wiz-foot">
        <div className="wiz-nav">{multi && <button type="button" onClick={() => setScreen("mode")}>Back</button>}</div>
        <LegalFooter className="disclaimer" />
      </footer>
    </main>
  );
}
