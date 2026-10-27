import { useEffect, useRef, useState } from "react";
import type { Session } from "../App";
import { useAudio, usePrefersReducedMotion, useSettings } from "../hooks";
import { LOOK_MS, planMove } from "../scene/pitwall/camera";
import { EVENT_OPEN_MS, eventNote, trackEvent } from "../scene/pitwall/trackEvents";
import type { View } from "../types";
import { markSeen, seenBefore } from "../scene/pitwall/introSeen";
import { useStage } from "../scene/pitwall/StageContext";
import { useRace } from "../useRace";
import { Monitor } from "./Monitor";
import { PreRace } from "./PreRace";
import { RaceScreen, type Layout, type Look } from "./RaceScreen";

export function Play({ session, onLeave, layout = "plain" }: { session: Session; onLeave: () => void; layout?: Layout }) {
  const race = useRace(session.roomId, session.team, session.seat);
  const { view, info, clock } = race.state;
  useAudio(race.store);
  const stage = useStage();
  const reduced = usePrefersReducedMotion();
  const { skipIntro } = useSettings();
  const plan = useRef<{ ms: number } | null>(null);
  const [look, setLook] = useState<Look>("wall");
  const [trackUp, setTrackUp] = useState(false); // the player looks up at the track
  const [note, setNote] = useState<string | null>(null); // something happened: a caption for a few seconds, over the band
  const prevView = useRef<View | null>(null);
  const eventTimer = useRef<number | undefined>(undefined);
  const ready = !!view && !!info;
  const sessionNow = view?.session;

  // The camera moves into the pit wall when the grid is first shown, before the clock runs. The plan is made once, from the first
  // state this screen sees, so a snapshot taken mid-race (a reconnect) goes straight to the end pose.
  useEffect(() => {
    if (!stage || !ready || !info || !sessionNow) return;
    let ms = reduced ? 0 : LOOK_MS;
    if (!plan.current) {
      plan.current = planMove({ reducedMotion: reduced, skipIntro, seenRoom: seenBefore(info.id), session: sessionNow });
      markSeen(info.id);
      ms = plan.current.ms;
    }
    // the strategist looks over to the screen on the right and back; the grid and the finish always show the wall
    const away = look === "strategy" && sessionNow !== "GRID"; // also after the finish: the debrief links to the chart
    stage.setPose(away ? "strategy" : "pitwall", ms);
  }, [stage, ready, info, sessionNow, reduced, skipIntro, look]);

  useEffect(() => {
    if (sessionNow === "GRID") setLook("wall");
  }, [sessionNow]);

  // The scenery is a thin band from the lights to the flag and after it. It opens only while the player looks up (the Track button). An
  // event of ours is a caption over the band: nothing on the page moves.
  useEffect(() => {
    if (!view || !info) return;
    const before = prevView.current;
    prevView.current = view;
    const event = trackEvent(before, view, info.human_cars);
    if (!event) return;
    setNote(eventNote(event, view.session));
    window.clearTimeout(eventTimer.current);
    eventTimer.current = window.setTimeout(() => setNote(null), EVENT_OPEN_MS);
  }, [view, info]);
  useEffect(() => () => window.clearTimeout(eventTimer.current), []);
  const collapsed = sessionNow !== undefined && sessionNow !== "GRID" && !trackUp;
  useEffect(() => {
    stage?.setDrop(collapsed ? 1 : 0, reduced ? 0 : LOOK_MS);
  }, [stage, collapsed, reduced]);

  // arrow keys look right and back, unless the player is typing in a field
  useEffect(() => {
    if (!stage || layout !== "pitwall") return;
    const key = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))) return;
      if (e.key === "ArrowRight") setLook("strategy");
      else if (e.key === "ArrowLeft") setLook("wall");
      else if (e.key === "ArrowUp") setTrackUp(true);
      else if (e.key === "ArrowDown") setTrackUp(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [stage, layout]);

  // the people of the pit wall follow this race
  useEffect(() => {
    stage?.attach(race.store);
    return () => stage?.attach(null);
  }, [stage, race.store]);

  useEffect(() => {
    if (stage && sessionNow) stage.setMonitors(sessionNow === "GRID" ? "briefing" : "race");
  }, [stage, sessionNow]);

  if (race.denied) return <main className="setup">This seat is no longer valid. <button onClick={onLeave}>Back</button></main>;
  if (!view || !info || !clock) return <main className="setup">{race.connected ? "Waiting for the grid…" : "Connecting…"}</main>;
  if (view.session === "GRID") {
    const pre = <PreRace race={race} onLeave={onLeave} />;
    return layout === "pitwall" ? (
      <Monitor name="briefing" className="monitor-briefing">
        {pre}
      </Monitor>
    ) : (
      pre
    );
  }
  return (
    <>
      <RaceScreen race={race} onLeave={onLeave} layout={layout} look={look} setLook={setLook} trackUp={trackUp} setTrackUp={setTrackUp} />
      {layout === "pitwall" && note && !trackUp && (
        <div className="track-note" role="status">
          {note}
        </div>
      )}
    </>
  );
}

export type RaceApi = ReturnType<typeof useRace>;
