import { useEffect, useState } from "react";
import { Landing } from "./components/Landing";
import { Play } from "./components/Play";
import { StartFlow } from "./components/StartFlow";
import { getGame } from "./api";
import { usePrefersReducedMotion, useSettings } from "./hooks";
import { RETURN_MS } from "./scene/pitwall/camera";
import { Stage } from "./scene/pitwall/Stage";
import { useStage } from "./scene/pitwall/StageContext";

export interface Session {
  roomId: string;
  team: string;
  /** The secret seat token of a multiplayer game; solo races have none. */
  seat?: string;
  multiplayer?: boolean;
}

const SEAT_KEY = "undercut.seat";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (kind: "session" | "local"): Store | null => {
  try {
    return kind === "session" ? sessionStorage : localStorage;
  } catch {
    return null; // storage may be blocked
  }
};
const readSeat = (kind: "session" | "local"): Session | null => {
  try {
    const v = JSON.parse(store(kind)?.getItem(SEAT_KEY) ?? "null");
    return v && typeof v.roomId === "string" && typeof v.team === "string" && typeof v.seat === "string" ? { ...v, multiplayer: true } : null;
  } catch {
    return null;
  }
};

/** A multiplayer seat is kept for this tab, so a refresh rejoins the same game (the server drives the cars meanwhile). It is per tab: a
 * second tab on the same address starts as itself, never as the player of the first. The last seat is also kept for the whole browser,
 * and is only offered as an explicit "Rejoin" (`lastSeat`), for a tab that was closed. */
export const saveSeat = (s: Session | null) => {
  try {
    if (s?.multiplayer) {
      store("session")?.setItem(SEAT_KEY, JSON.stringify(s));
      store("local")?.setItem(SEAT_KEY, JSON.stringify(s));
    } else {
      store("session")?.removeItem(SEAT_KEY);
      store("local")?.removeItem(SEAT_KEY);
    }
  } catch { /* the game just cannot be rejoined by refreshing */ }
};
export const savedSeat = (): Session | null => readSeat("session");
export const lastSeat = (): Session | null => readSeat("local");

type Phase = "landing" | "setup" | "play";

/** Sends the camera back to the wide shot whenever the player is not in a race. */
function Wide({ phase }: { phase: Phase }) {
  const stage = useStage();
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (phase !== "play") {
      stage?.setMonitors("none");
      stage?.setPose("landing", reduced ? 0 : RETURN_MS);
    }
  }, [phase, stage, reduced]);
  return null;
}

export function App() {
  const settings = useSettings();
  const [glFailed, setGlFailed] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);
  const setSession = (s: Session | null) => {
    saveSeat(s);
    setSessionState(s);
  };
  useEffect(() => {
    const saved = savedSeat();
    if (!saved) return;
    // only rejoin a game that still exists
    getGame(saved.roomId).then(() => setSessionState(saved), () => saveSeat(null));
  }, []);
  const [entered, setEntered] = useState(false);

  if (glFailed) {
    // without WebGL the scene cannot be drawn: the same screens as a page
    return session ? <Play session={session} onLeave={() => setSession(null)} /> : <StartFlow onStart={setSession} />;
  }

  const phase: Phase = session ? "play" : settings.skipIntro || entered ? "setup" : "landing";
  return (
    <Stage onUnavailable={() => setGlFailed(true)}>
      <Wide phase={phase} />
      {phase === "landing" && <Landing onEnter={() => setEntered(true)} />}
      {phase === "setup" && (
        <div className="card-overlay">
          <StartFlow onStart={setSession} />
        </div>
      )}
      {phase === "play" && session && <Play session={session} onLeave={() => setSession(null)} layout="pitwall" />}
    </Stage>
  );
}
