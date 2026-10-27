import { Gloss, GlossaryScope } from "./Gloss";
import { useCallback, useRef, useState } from "react";
import { useMyColour, useNames } from "../hooks";
import { loadSettings, saveSettings } from "../settings";
import { TrackScene } from "../scene/TrackScene";
import { clockText } from "../format";
import { AudioControls } from "./AudioControls";
import { PacksButton } from "./PacksButton";
import { Debrief } from "./Debrief";
import { SpeedVoteBox } from "./SpeedVoteBox";
import type { RaceApi } from "./Play";
import { Messages } from "./Messages";
import { PitControls } from "./PitControls";
import { RadioPanel, RadioRequests } from "./RadioPanel";
import { SwapControl } from "./SwapControl";
import { Tower } from "./Tower";
import { circuitName } from "./setup/circuits";
import { Monitor } from "./Monitor";
import { Results } from "./Results";
import { swapOffer } from "../swapUi";
import { Strategy } from "./Strategy";
import { TrackMap } from "./TrackMap";
import { WeatherPanel } from "./WeatherPanel";

const BANNER: Record<string, string> = { SC: "SAFETY CAR", VSC: "VIRTUAL SAFETY CAR", RED: "RED FLAG", FINISHED: "FINISHED" };

export type Layout = "plain" | "pitwall";

/** `plain` is the page layout; `pitwall` puts the same panels on the monitors of the stage (docs/presentation-design.md section 3). */
export type Look = "wall" | "strategy";

export function RaceScreen({ race, onLeave, layout = "plain", look = "wall", setLook = () => {}, trackUp = false, setTrackUp = () => {} }: { race: RaceApi; onLeave: () => void; layout?: Layout; look?: Look; setLook?: (l: Look) => void; trackUp?: boolean; setTrackUp?: (up: boolean) => void }) {
  const { view, info, clock, messages, error } = race.state;
  const [debrief, setDebrief] = useState(false);
  const [focusLap, setFocusLap] = useState<{ lap: number; car: string; n: number } | null>(null); // a decision of the debrief, shown in the Strategy chart
  const mine = useMyColour(race.state.info?.human_team);
  const names = useNames();
  const [tab, setTab] = useState<"pit" | "radio">("pit");
  const [scene, setSceneOn] = useState(() => loadSettings().scene);
  const setScene = useCallback((on: boolean) => {
    setSceneOn(on);
    saveSettings({ ...loadSettings(), scene: on });
  }, []);
  const sceneUnavailable = useCallback(() => setSceneOn(false), []);
  // Sound and Packs are pop-ups over a running race: pause while one is open (when pausing is allowed) and resume only what we paused
  const pausedByPopup = useRef(false);
  const popup = (open: boolean) => {
    const canPause = !!clock && !info?.multiplayer && clock.pause_allowed;
    if (open && canPause && !clock.paused && view?.session !== "FINISHED") {
      pausedByPopup.current = true;
      race.pause();
    } else if (!open && pausedByPopup.current) {
      pausedByPopup.current = false;
      race.resume();
    }
  };
  if (!view || !info || !clock) return null;
  const finished = view.session === "FINISHED";
  const offer = swapOffer(view, info.human_cars, info.swap_window_s);
  const swapPending = info.human_cars.some((id) => view.own[id]?.swap);
  return (
    <GlossaryScope>
    <div className={`race session-${view.session.toLowerCase()} layout-${layout}${look === "strategy" ? " look-strategy" : ""}`} style={{ ["--mine" as string]: mine }}>
      <header>
        <strong>{names.circuit(info.circuit, circuitName(info.circuit))}</strong>
        <span className="lapcount">
          Lap {view.race_lap}/{view.total_laps}
          <span className="to-go">{view.total_laps - view.race_lap > 0 ? `${view.total_laps - view.race_lap} to go` : "final lap"}</span>
        </span>
        <span className="clock">{clockText(view.time_s)}</span>
        {offer.ok && !finished && !swapPending && (
          <button className="hint" onClick={() => setTab("pit")} title={`${names.driverShort(offer.lead)} is ${offer.gap.toFixed(1)} s ahead of ${names.driverShort(offer.rear)}: a team order is possible`}>
            Team order ready
          </button>
        )}
        {BANNER[view.session] && (
          <span className="banner">
            {view.session === "SC" || view.session === "VSC" ? <Gloss term={view.session}>{BANNER[view.session]}</Gloss> : BANNER[view.session]}
          </span>
        )}
        <span className="spacer" />
        {!race.connected && <span className="banner">RECONNECTING…</span>}
        {!finished && (
          <span className="speedbox">
            {[1, 2, 5, 10].map((s) => (
              <button key={s} className={clock.speed === s ? "chosen" : ""} onClick={() => race.setSpeed(s)}>
                {s}x
              </button>
            ))}
            {!info.multiplayer && (
              <button disabled={!clock.pause_allowed && !clock.paused} onClick={clock.paused ? race.resume : race.pause}>
                {clock.paused ? "Resume" : "Pause"}
              </button>
            )}
            {info.multiplayer && <SpeedVoteBox race={race} />}
          </span>
        )}
        <AudioControls onOpenChange={popup} />
        <PacksButton onOpenChange={popup} />
        {layout === "pitwall" && !finished && (
          <button className={trackUp ? "chosen" : ""} onClick={() => setTrackUp(!trackUp)} title="Look up at the track (up arrow, down arrow to go back)">
            Track ▴
          </button>
        )}
        {layout === "pitwall" && !finished && <button onClick={() => setLook("strategy")} title="Look at the strategy screen (right arrow)">Strategy ▸</button>}
        {layout !== "pitwall" && (
          <button className={scene ? "chosen" : ""} onClick={() => setScene(!scene)} title="Draw the track with the WebGL scene">
            Scene
          </button>
        )}
        <button className="link" onClick={onLeave}>
          Leave
        </button>
      </header>
      {clock.paused && !finished && view.session !== "GRID" && (
        <div className="paused-overlay" role="status">
          <span>PAUSED</span>
          <small>{pausedByPopup.current ? "while this window is open" : "the clock is stopped; you can still make calls"}</small>
        </div>
      )}
      {layout === "pitwall" ? (
        <>
          <Monitor name="tower" inert={look === "strategy"}>
            <Tower view={view} humanCars={info.human_cars} />
          </Monitor>
          <Monitor name="map" className="monitor-stack" inert={look === "strategy"}>
            <WeatherPanel view={view} />
            <TrackScene store={race.store} circuit={info.circuit} onUnavailable={sceneUnavailable} />
          </Monitor>
          <Monitor name="ops" className="monitor-stack" inert={look === "strategy"}>
            <RadioRequests race={race} />
            <div className="radio-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "pit"} className={tab === "pit" ? "chosen" : ""} onClick={() => setTab("pit")}>
                Pit and orders
              </button>
              <button role="tab" aria-selected={tab === "radio"} className={tab === "radio" ? "chosen" : ""} onClick={() => setTab("radio")}>
                Team radio
              </button>
            </div>
            {tab === "pit" ? (
              <>
                {!finished && (offer.ok || swapPending) && <SwapControl race={race} />}
                <PitControls view={view} race={race} humanCars={info.human_cars} disabled={finished} />
                {!finished && !offer.ok && !swapPending && <SwapControl race={race} />}
              </>
            ) : (
              <RadioPanel race={race} />
            )}
            {error && <p className="error">{error}</p>}
            <Messages messages={messages} />
          </Monitor>
          <Strategy race={race} look={look} setLook={setLook} focusLap={focusLap} />
        </>
      ) : (
        <div className="columns">
          <Tower view={view} humanCars={info.human_cars} />
          <div className="side">
            <WeatherPanel view={view} />
            {scene ? (
              <TrackScene store={race.store} circuit={info.circuit} onUnavailable={sceneUnavailable} />
            ) : (
              <TrackMap view={view} humanCars={info.human_cars} paused={clock.paused || finished} circuit={info.circuit} />
            )}
            <RadioRequests race={race} />
            <PitControls view={view} race={race} humanCars={info.human_cars} disabled={finished} />
            {!finished && <SwapControl race={race} />}
            <RadioPanel race={race} />
            {error && <p className="error">{error}</p>}
            <Messages messages={messages} />
          </div>
        </div>
      )}
      {finished && debrief && (
        <Debrief roomId={info.id} names={Object.fromEntries(view.cars.map((c) => [c.id, names.driver(c.id)]))} onClose={() => setDebrief(false)}
          onShowLap={(lap, car) => { setFocusLap((f) => ({ lap, car, n: (f?.n ?? 0) + 1 })); setLook("strategy"); }} />
      )}
      {finished && !debrief && <Results view={view} info={info} laps={race.state.laps} onDebrief={info.multiplayer ? undefined : () => setDebrief(true)} onLeave={onLeave} />}
    </div>
    </GlossaryScope>
  );
}
