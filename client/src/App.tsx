import { useEffect, useRef, useState } from "react";
import { Landing } from "./components/Landing";
import { Play } from "./components/Play";
import { StartFlow } from "./components/StartFlow";
import { getGame, getRace } from "./api";
import { raceFromSearch, raceUrl } from "./nav";
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

const SEATS_KEY = "undercut.seats";
/** Every multiplayer seat this tab has held, by room, so Back to a game that was left (its results) can take its seat again. */
const seatFor = (roomId: string): Session | null => {
  try {
    const v = JSON.parse(store("session")?.getItem(SEATS_KEY) ?? "{}")[roomId];
    return v && typeof v.team === "string" && typeof v.seat === "string" ? { roomId, team: v.team, seat: v.seat, multiplayer: true } : null;
  } catch {
    return null;
  }
};
const rememberSeat = (s: Session) => {
  try {
    const all = JSON.parse(store("session")?.getItem(SEATS_KEY) ?? "{}");
    store("session")?.setItem(SEATS_KEY, JSON.stringify({ ...all, [s.roomId]: { team: s.team, seat: s.seat } }));
  } catch { /* the seat is still in the tab's current-seat slot */ }
};

/** A multiplayer seat is kept for this tab, so a refresh rejoins the same game (the server drives the cars meanwhile). It is per tab: a
 * second tab on the same address starts as itself, never as the player of the first. The last seat is also kept for the whole browser,
 * and is only offered as an explicit "Rejoin" (`lastSeat`), for a tab that was closed. */
export const saveSeat = (s: Session | null) => {
  try {
    if (s?.multiplayer) {
      rememberSeat(s);
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
      stage?.setDrop(0, reduced ? 0 : RETURN_MS); // a race leaves the camera dropped (the thin scenery band); the landing and setup screens are laid out for the full wall
    }
  }, [phase, stage, reduced]);
  return null;
}

/** The session for a race named in the address: a solo race by its id, a multiplayer one with the seat this tab holds. Null when the
 * server has forgotten the race or there is no seat for it here. */
async function sessionForRace(id: string): Promise<Session | null> {
  try {
    const info = await getRace(id);
    if (info.multiplayer) return seatFor(id);
    return info.human_team ? { roomId: id, team: info.human_team } : null;
  } catch {
    return null;
  }
}

export function App() {
  const settings = useSettings();
  const [glFailed, setGlFailed] = useState(false);
  const [session, setSessionState] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = useRef<Session | null>(null);
  current.current = session;
  // Starting a race, or leaving one, is a step in the browser's history: Back from the start screen returns to the race (and, for a
  // finished one, to its results) for as long as the server keeps it.
  const setSession = (s: Session | null) => {
    saveSeat(s);
    history.pushState(null, "", s ? raceUrl(s.roomId) : "/");
    setNotice(null);
    setSessionState(s);
  };
  useEffect(() => {
    const show = async () => {
      const id = raceFromSearch(location.search);
      if (id && id === current.current?.roomId) return;             // only the Debrief hash changed
      if (!id) {
        setSessionState(null);
        return;
      }
      const s = await sessionForRace(id);
      if (s) {
        setNotice(null);
        setSessionState(s);
      } else {
        setSessionState(null);
        setNotice("That race is no longer on the server, or its seat is not in this browser tab.");
        history.replaceState(null, "", "/");
      }
    };
    const onPop = () => void show();
    window.addEventListener("popstate", onPop);
    if (raceFromSearch(location.search)) void show();               // a link, a refresh or a reopened tab
    else {
      const saved = savedSeat();                                     // the old way: a tab that held a multiplayer seat
      if (saved) getGame(saved.roomId).then(() => { rememberSeat(saved); history.replaceState(null, "", raceUrl(saved.roomId)); setSessionState(saved); }, () => saveSeat(null));
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [entered, setEntered] = useState(false);

  const noticeEl = notice && (
    <p className="app-notice" role="status" onClick={() => setNotice(null)}>
      {notice}
    </p>
  );

  if (glFailed) {
    // without WebGL the scene cannot be drawn: the same screens as a page
    return session ? <Play session={session} onLeave={() => setSession(null)} /> : <>{noticeEl}<StartFlow onStart={setSession} /></>;
  }

  const phase: Phase = session ? "play" : settings.skipIntro || entered ? "setup" : "landing";
  return (
    <Stage onUnavailable={() => setGlFailed(true)}>
      <Wide phase={phase} />
      {phase !== "play" && noticeEl}
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
