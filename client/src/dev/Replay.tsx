/** Development harness: the scene driven by a synthetic race, no server needed (`/?replay`, optional `&speed=5&cars=22`).
 * It exists to look at the scene and to measure frame times without depending on the backend; nothing in the game imports it. */
import { useEffect, useMemo, useState } from "react";
import { emptyResolver, loadResolver } from "../packs/browser";
import { ModelStore } from "../render/store";
import { synth } from "../render/synth";
import { RaceScreen } from "../components/RaceScreen";
import { Landing } from "../components/Landing";
import { LOOK_MS, planMove } from "../scene/pitwall/camera";
import { Stage } from "../scene/pitwall/Stage";
import { useStage } from "../scene/pitwall/StageContext";
import { TrackScene } from "../scene/TrackScene";
import { useAudio } from "../hooks";
import { useSynthRace } from "./useSynthRace";

const params = new URLSearchParams(location.search);

export function Replay() {
  const store = useMemo(() => new ModelStore(emptyResolver()), []);
  const [load, setLoad] = useState("");
  const [stats, setStats] = useState("");
  const speed = Number(params.get("speed") ?? 1);

  useEffect(() => {
    let stop = false;
    loadResolver().then(async (resolver) => {
      store.setResolver(resolver, performance.now());
      const pack = await (await fetch("/packs/base-fictional/manifest.json")).json();
      const teams = Object.keys(pack.teams);
      const carIds = Object.keys(pack.drivers).map((id, i) => ({ id, team: teams[Math.floor(i / 2)] })).slice(0, Number(params.get("cars") ?? 22));
      const gen = synth({ seed: Number(params.get("seed") ?? 3), carIds, laps: 40, lapS: 60, human: [carIds[2].id, carIds[3].id], safetyCar: [140, 200], retire: carIds.length > 9 ? { [carIds[9].id]: 90 } : {}, pitLaps: [2, 5] });
      let simT = 0;
      let last = performance.now();
      let held: ReturnType<typeof gen.next> | null = null;
      const pump = () => {
        if (stop) return;
        const now = performance.now();
        simT += ((now - last) / 1000) * speed;
        last = now;
        for (;;) {
          const n = held ?? gen.next();
          held = null;
          if (n.done) return;
          const m = n.value;
          if (m.type === "state" && m.view.time_s > simT) {
            held = n;
            break;
          }
          store.push(m, performance.now());
        }
        requestAnimationFrame(pump);
      };
      pump();
    });
    const t = window.setInterval(() => {
      const s = window.__undercutScene;
      if (s) setStats(`${s.fps.toFixed(0)} fps, mean ${s.meanMs.toFixed(1)} ms, cpu ${s.cpuMs.toFixed(2)} ms, p95 ${s.p95Ms.toFixed(1)} ms, ${s.cars} cars`);
      setLoad(`t ${store.model?.t.toFixed(0) ?? "-"} s, ${store.model?.lighting ?? "-"}`);
    }, 500);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [store, speed]);

  return (
    <div className="replay">
      <header>
        <strong>Scene replay</strong>
        <span>{load}</span>
        <span className="muted">{stats}</span>
      </header>
      <TrackScene store={store} circuit={params.get("circuit") ?? "austin"} />
    </div>
  );
}

/** The real race screen on the pit-wall stage, fed by the synthetic race. `&intro=1` plays the move from the landing shot. */
function PitWallDemo() {
  const race = useSynthRace();
  useAudio(race.store);
  const stage = useStage();
  const intro = params.get("intro") === "1";
  useEffect(() => {
    stage?.attach(race.store);
    return () => stage?.attach(null);
  }, [stage, race.store]);
  useEffect(() => {
    stage?.setMonitors("race");
    const ms = planMove({ reducedMotion: false, skipIntro: !intro, seenRoom: false, session: intro ? "GRID" : "RACING" }).ms;
    const t = window.setTimeout(() => stage?.setPose("pitwall", ms), intro ? 1500 : 0);
    return () => window.clearTimeout(t);
  }, [stage, intro]);
  const [look, setLook] = useState<"wall" | "strategy">(params.get("look") === "strategy" ? "strategy" : "wall");
  useEffect(() => {
    stage?.setPose(look === "strategy" ? "strategy" : "pitwall", look === "strategy" && params.get("look") === "strategy" ? 0 : LOOK_MS);
  }, [stage, look]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setLook("strategy");
      else if (e.key === "ArrowLeft") setLook("wall");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!race.state.view) return null;
  return <RaceScreen race={race} onLeave={() => undefined} layout="pitwall" look={look} setLook={setLook} />;
}

function LandingDemo() {
  return <Landing onEnter={() => undefined} />;
}

export function ReplayRoot() {
  const screen = params.get("screen");
  if (screen === "pitwall")
    return (
      <Stage>
        <PitWallDemo />
      </Stage>
    );
  if (screen === "landing")
    return (
      <Stage>
        <LandingDemo />
      </Stage>
    );
  return <Replay />;
}
