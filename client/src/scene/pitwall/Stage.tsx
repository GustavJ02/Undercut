/** The persistent pit-wall stage: one full-window Pixi canvas for the scene and a 1920x1080 DOM layer for the monitors, driven by
 * one camera. The canvas is never CSS-scaled (the camera is applied to the Pixi world), and the DOM layer gets the same matrix as
 * a CSS transform, so at the end pose both are at native pixels. It lives above the app's screens so the move from the landing
 * page into the pit wall is continuous. React renders only on start and end of a move; the per-frame work is the camera. */
import { Application, Container } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FrameMeter } from "../../render/frameMeter";
import { DESTROY, SIMULATE_NO_WEBGL } from "../destroy";
import type { ModelStore } from "../../render/store";
import { audio } from "../../audio/instance";
import { CarsLayer } from "../cars/CarsLayer";
import { SceneFx } from "../fx/SceneFx";
import { PeopleLayer } from "../people/PeopleLayer";
import { buildBackdrop, type Backdrop } from "./backdrop";
import { POSES, deskness, easeInOutCubic, matrixFor, poseAt, progressAt, withDrop, type Pose, type PoseName, type Tween } from "./camera";
import { STAGE } from "./layout";
import { StageContext, type StageApi } from "./StageContext";

export interface StageStats {
  pose: PoseName;
  tweening: boolean;
  progress: number;
  move: { frames: number; meanMs: number; p95Ms: number; maxMs: number } | null; // frame times during the last move
  glReady: boolean;
}

declare global {
  interface Window {
    __undercutStage?: StageStats;
  }
}

export function Stage({ children, onUnavailable }: { children: ReactNode; onUnavailable?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const glHost = useRef<HTMLDivElement>(null);
  const dom = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);

  // camera state lives outside React: it changes every frame during a move
  const cam = useRef({ pose: { ...POSES.landing } as Pose, target: "landing" as PoseName, source: "landing" as PoseName, tween: null as Tween | null, progress: 1, dirty: true, drop: { value: 0, from: 0, to: 0, start: 0, duration: 0 } }); // progress is toward the target; at rest it is 1; drop is the thin-band camera
  const world = useRef<Container | null>(null);
  const backdrop = useRef<Backdrop | null>(null);
  const people = useRef<PeopleLayer | null>(null);
  const carsLayer = useRef<CarsLayer | null>(null);
  const fx = useRef<SceneFx | null>(null);
  const attached = useRef<ModelStore | null>(null);
  const monitors = useRef<"race" | "briefing" | "none">("none");
  const moveFrames = useRef(new FrameMeter(400));
  const lastStats = useRef<StageStats["move"]>(null);

  const apply = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const c = cam.current;
    const posed = withDrop(c.pose, c.drop.value);
    const m = matrixFor(posed, el.clientWidth, el.clientHeight);
    if (dom.current) {
      dom.current.style.transform = `translate(${m.tx}px, ${m.ty}px) scale(${m.scale})`;
      dom.current.style.willChange = c.tween ? "transform" : "auto";
    }
    const camT = deskness(c.source, c.target, c.progress);
    el.style.setProperty("--cam-t", String(camT));
    const look = Math.min(Math.max((c.pose.fx - POSES.pitwall.fx) / (POSES.strategy.fx - POSES.pitwall.fx), 0), 1);
    el.style.setProperty("--look-t", String(look));                      // 0 on the wall, 1 at the strategy screen
    el.style.setProperty("--pan-x", `${c.pose.fx - POSES.pitwall.fx}px`); // how far the camera has turned, so the top bar can follow it
    el.style.setProperty("--pan-y", `${Math.max(posed.fy - POSES.pitwall.fy, 0)}px`);
    el.style.setProperty("--drop", String(c.drop.value)); // the monitors grow by the distance the camera dropped
    if (world.current && backdrop.current) {
      world.current.scale.set(m.scale);
      world.current.position.set(m.tx, m.ty);
      backdrop.current.applyParallax(posed);
      backdrop.current.setDrop(c.drop.value);
      backdrop.current.setBezelAlpha(Math.min(Math.max((camT - 0.3) / 0.4, 0), 1), look);
    }
    c.dirty = false;
  }, []);

  const finish = useCallback(() => {
    const c = cam.current;
    c.pose = { ...POSES[c.target] };
    c.progress = 1;
    c.tween = null;
    c.dirty = true;
    const m = moveFrames.current;
    lastStats.current = m.count ? { frames: m.count, meanMs: m.mean, p95Ms: m.p95, maxMs: m.max } : null;
    setMoving(false);
  }, []);

  const api = useMemo<StageApi>(
    () => ({
      setPose(name, ms) {
        const c = cam.current;
        if (c.target === name) return;
        const from = c.pose;
        c.source = c.target;
        c.target = name;
        moveFrames.current = new FrameMeter(400);
        if (ms <= 0) {
          c.pose = { ...POSES[name] };
          c.progress = 1;
          c.tween = null;
          c.dirty = true;
          setMoving(false);
        } else {
          c.tween = { from, to: POSES[name], start: performance.now(), duration: ms };
          c.progress = 0;
          setMoving(true);
        }
      },
      setDrop(drop, ms) {
        const d = cam.current.drop;
        if (d.to === drop) return;
        Object.assign(d, { from: d.value, to: drop, start: performance.now(), duration: ms });
        cam.current.dirty = true;
      },
      skip() {
        if (cam.current.tween) finish();
      },
      attach(store) {
        attached.current = store;
        people.current?.attach(store);
        carsLayer.current?.attach(store);
        fx.current?.attach(store);
      },
      setMonitors(mode) {
        monitors.current = mode;
        backdrop.current?.setMonitors(mode);
      },
    }),
    [finish],
  );

  // the camera loop: runs for the life of the stage, does work only while something moves
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const c = cam.current;
      if (c.tween) {
        moveFrames.current.add(now - last);
        c.pose = poseAt(c.tween, now);
        c.progress = progressAt(c.tween, now);
        if (now - c.tween.start >= c.tween.duration) finish();
        apply();
      } else if (c.dirty) apply();
      const d = c.drop;
      if (d.value !== d.to) {
        const t = d.duration <= 0 ? 1 : Math.min((now - d.start) / d.duration, 1);
        d.value = t >= 1 ? d.to : d.from + (d.to - d.from) * easeInOutCubic(t);
        apply();
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => (cam.current.dirty = true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [apply, finish]);

  // Space, Enter or Escape skips a move in progress
  useEffect(() => {
    if (!moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter" || e.key === "Escape") api.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving, api]);

  // the Pixi scene
  useEffect(() => {
    const host = glHost.current;
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;
    (async () => {
      const a = new Application();
      try {
        if (SIMULATE_NO_WEBGL) throw new Error("WebGL switched off for testing (?nogl)");
        await a.init({ preference: "webgl", resizeTo: host, background: 0x05070a, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
      } catch {
        if (!cancelled) onUnavailable?.();
        return;
      }
      if (cancelled) {
        a.destroy(...DESTROY);
        return;
      }
      app = a;
      host.appendChild(a.canvas);
      const w = new Container();
      const b = buildBackdrop();
      b.setMonitors(monitors.current);
      w.addChild(b.root);
      a.stage.addChild(w);
      world.current = w;
      backdrop.current = b;
      people.current = new PeopleLayer(b.people.lane, b.people.wall);
      people.current.attach(attached.current);
      people.current.onStop = () => audio.gun();
      carsLayer.current = new CarsLayer(a.renderer, b.cars.track, b.cars.lane);
      carsLayer.current.attach(attached.current);
      fx.current = new SceneFx(b.fx);
      fx.current.attach(attached.current);
      a.ticker.add(() => {
        const now = performance.now();
        people.current?.update(now);
        carsLayer.current?.update(now);
        fx.current?.update(now);
      });
      cam.current.dirty = true;
    })();
    return () => {
      cancelled = true;
      world.current = null;
      backdrop.current = null;
      people.current = null;
      carsLayer.current = null;
      fx.current = null;
      if (app) app.destroy(...DESTROY);
    };
  }, [onUnavailable]);

  // test hook: the stage's state, readable from a script
  useEffect(() => {
    const t = window.setInterval(() => {
      const c = cam.current;
      window.__undercutStage = { pose: c.target, tweening: !!c.tween, progress: c.progress, move: lastStats.current, glReady: !!world.current };
    }, 100);
    return () => {
      window.clearInterval(t);
      delete window.__undercutStage;
    };
  }, []);

  return (
    <StageContext.Provider value={api}>
      <div className="stage" ref={root}>
        <div className="stage-gl" ref={glHost} />
        <div className="stage-dom" ref={dom} style={{ width: STAGE.w, height: STAGE.h }}>
          {children}
        </div>
        <div className="stage-vignette" />
        {moving && (
          <button className="stage-skip" onClick={api.skip}>
            Skip
          </button>
        )}
      </div>
    </StageContext.Provider>
  );
}
