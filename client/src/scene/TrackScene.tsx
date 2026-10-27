/** The Pixi scene skeleton (P1): the circuit outline with every car drawn from the render model, moving at 60 fps between states.
 * React owns the element and nothing else: the ticker reads the `ModelStore` directly, so state updates never cause a React render.
 * Cars are sprites from a per-livery texture (generated once from `livery.ts`) with an upright number label. */
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { DESTROY, SIMULATE_NO_WEBGL } from "./destroy";
import { drawShapes } from "./draw";
import { FrameMeter } from "../render/frameMeter";
import type { Lighting, RenderCar } from "../render/model";
import type { ModelStore } from "../render/store";
import type { Outline } from "../track";
import { BODY, PARTS, PATTERN_SHAPES, liveryKey } from "./livery";
import { outlineFor, sampleOutline, type Placed } from "./path";

const CAR_LEN = 15; // outline units; the track is drawn 15 wide
const TRACK_W = 15;
const TEX_PX = 96; // texture length in pixels before the device ratio
const LABEL_PX = 11; // screen pixels, whatever the scale of the world
const LIGHT: Record<Lighting, number | null> = { green: null, yellow: 0xf2c230, sc: 0xf2c230, vsc: 0xf2c230, red: 0xe8334a, chequered: 0xe6e9ef };

export interface SceneStats {
  fps: number;
  cpuMs: number; // mean JavaScript time per frame in the scene's own update, independent of vsync and GPU
  meanMs: number;
  p95Ms: number;
  cars: number;
}

declare global {
  interface Window {
    __undercutScene?: SceneStats;
  }
}

const hex = (c: string) => parseInt(c.slice(1), 16);

class CarNode {
  root = new Container();
  body: Sprite;
  label: Text;
  ring: Graphics;
  key = "";

  constructor(tex: Texture, public car: RenderCar, mine: boolean) {
    this.body = new Sprite(tex);
    this.body.anchor.set(0.5);
    this.body.width = CAR_LEN;
    this.body.height = CAR_LEN * (tex.height / tex.width);
    this.label = new Text({ text: String(car.num), style: { fontSize: 44, fontFamily: "system-ui, sans-serif", fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 4 } }, resolution: 1 });
    this.label.anchor.set(0.5);
    this.ring = new Graphics();
    if (mine) this.ring.circle(0, 0, CAR_LEN * 0.62).stroke({ color: 0xffffff, width: 1, alpha: 0.85 });
    this.root.addChild(this.ring, this.body, this.label);
  }
}

export function TrackScene({ store, circuit, onUnavailable }: { store: ModelStore; circuit: string; onUnavailable?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let app: Application | null = null;
    let dispose: (() => void) | null = null;
    const watch = new ResizeObserver(() => app?.resize()); // Pixi follows the window, not the box: the monitor grows when the camera drops
    watch.observe(el);
    (async () => {
      const a = new Application();
      try {
        if (SIMULATE_NO_WEBGL) throw new Error("WebGL switched off for testing (?nogl)");
        await a.init({ preference: "webgl", resizeTo: el, background: 0x0e1116, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
      } catch {
        if (!cancelled) {
          setFailed(true);
          onUnavailable?.();
        }
        return;
      }
      if (cancelled) {
        a.destroy(...DESTROY);
        return;
      }
      app = a;
      el.appendChild(a.canvas);
      dispose = run(a, store, outlineFor(circuit));
    })();
    return () => {
      cancelled = true;
      watch.disconnect();
      dispose?.();
      if (app) app.destroy(...DESTROY);
      delete window.__undercutScene;
    };
  }, [store, circuit, onUnavailable]);

  if (failed) return <p className="muted">The scene needs WebGL, which is not available here.</p>;
  return <div ref={host} className="scene" role="img" aria-label="Track scene" />;
}

/** Show the number labels of `nodes` (most important first) but not one that would sit on top of a label already shown. `scale` is the
 * label's world-space scale; a label is about 1.3 heights wide for two digits, so 2.6 keeps a gap between two. */
export function declutter(nodes: { root: { x: number; y: number }; label: { y: number; visible: boolean } }[], scale: number): void {
  const h = LABEL_PX * scale, w = h * 2.6;
  const shown: { x: number; y: number }[] = [];
  for (const n of nodes) {
    const x = n.root.x, y = n.root.y + n.label.y;
    const clash = shown.some((s) => Math.abs(s.x - x) < w && Math.abs(s.y - y) < h);
    n.label.visible = !clash;
    if (!clash) shown.push({ x, y });
  }
}

/** Builds the scene on `app`; returns a function that frees the textures it made. */
function run(app: Application, store: ModelStore, outline: Outline): () => void {
  const world = new Container();
  const track = new Graphics();
  const line = new Graphics();
  const frame = new Graphics();
  const cars = new Container();
  const scCar = new Container(); // the safety car: a yellow car with its own mark on the map
  scCar.addChild(new Graphics().roundRect(-10, -5.5, 20, 11, 3).fill(0xf2c230).stroke({ color: 0x14171c, width: 1.2 }));
  const scText = new Text({ text: "SC", style: { fontSize: 9, fontFamily: "system-ui, sans-serif", fontWeight: "800", fill: 0x14171c }, resolution: 2 });
  scText.anchor.set(0.5);
  scCar.addChild(scText);
  scCar.visible = false;
  world.addChild(track, line, cars, scCar);
  app.stage.addChild(world, frame);

  const pts = outline.pts.flatMap((p) => [p.x, p.y]);
  track.poly(pts, true).stroke({ color: 0x262d38, width: TRACK_W, join: "round" });
  track.poly(pts, true).stroke({ color: 0x3a4352, width: 0.8, alpha: 0.8 });
  const a = outline.pts[0], b = outline.pts[1];
  const h = Math.atan2(b.y - a.y, b.x - a.x);
  line.moveTo(a.x - Math.sin(h) * TRACK_W * 0.5, a.y + Math.cos(h) * TRACK_W * 0.5).lineTo(a.x + Math.sin(h) * TRACK_W * 0.5, a.y - Math.cos(h) * TRACK_W * 0.5).stroke({ color: 0xe6e9ef, width: 1.5 });

  const textures = new Map<string, Texture>();
  const textureFor = (c: RenderCar): Texture => {
    const key = liveryKey(c.livery);
    let t = textures.get(key);
    if (!t) {
      const px = TEX_PX;
      const slot = { primary: hex(c.livery.primary), secondary: hex(c.livery.secondary), accent: hex(c.livery.accent), dark: 0x14171c, helmet: 0xe6e9ef };
      const g = new Graphics();
      g.poly(BODY.flatMap(([x, y]) => [x * px, y * px])).fill(slot.primary);
      drawShapes(g, PATTERN_SHAPES[c.livery.pattern] ?? [], (s) => slot[s], px); // an unknown pattern draws as solid
      drawShapes(g, PARTS, (s) => slot[s], px);
      g.poly(BODY.flatMap(([x, y]) => [x * px, y * px])).stroke({ color: 0x000000, width: 1.2, alpha: 0.55 });
      t = app.renderer.generateTexture({ target: g, resolution: 2, frame: undefined });
      g.destroy();
      textures.set(key, t);
    }
    return t;
  };

  const turnLabels: Text[] = [];
  let turnsFor = "";
  const nodes = new Map<string, CarNode>();
  const placed: Placed = { x: 0, y: 0, heading: 0 };
  const meter = new FrameMeter(120);
  const cpu = new FrameMeter(120);
  let fitted = "";
  let labelScale = 1;
  const placeTurn = (t: Text) => t.scale.set(labelScale * 0.8); // turn numbers keep a screen size, like car numbers
  const placeLabel = (n: CarNode) => {
    n.label.scale.set(labelScale);
    n.label.y = -CAR_LEN * 0.85 - (LABEL_PX * 0.5) * labelScale;
  };
  let lighting: Lighting | null = null;

  app.ticker.add((ticker) => {
    meter.add(ticker.deltaMS);
    const t0 = performance.now();
    const model = store.model;
    const w = app.screen.width, ht = app.screen.height;
    const fit = `${w}x${ht}`;
    if (fit !== fitted) {
      fitted = fit;
      const s = Math.min(w / outline.width, ht / outline.height);
      world.scale.set(s);
      world.position.set((w - outline.width * s) / 2, (ht - outline.height * s) / 2);
      labelScale = LABEL_PX / 44 / s;
      for (const n of nodes.values()) placeLabel(n);
      turnLabels.forEach(placeTurn);
      lighting = null;
    }
    if (!model) return;
    const turnKey = model.corners.map((c) => c.n).join(",");
    if (turnKey !== turnsFor) {
      turnsFor = turnKey;
      turnLabels.splice(0).forEach((t) => t.destroy());
      for (const c of model.corners) {
        const t = new Text({ text: String(c.n), style: { fontSize: 44, fontFamily: "system-ui, sans-serif", fontWeight: "600", fill: 0x8b95a5 }, resolution: 1 });
        t.anchor.set(0.5);
        sampleOutline(outline, c.frac, placed);
        t.position.set(placed.x, placed.y - TRACK_W * 0.9);
        placeTurn(t);
        cars.addChildAt(t, 0);
        turnLabels.push(t);
      }
    }
    if (model.lighting !== lighting) {
      lighting = model.lighting;
      frame.clear();
      const colour = LIGHT[lighting];
      if (colour !== null) frame.rect(2, 2, w - 4, ht - 4).stroke({ color: colour, width: 4 });
    }
    const now = performance.now();
    const mine = new Set(model.mine);
    for (const c of model.cars) {
      let n = nodes.get(c.id);
      if (!n) {
        n = new CarNode(textureFor(c), c, mine.has(c.id));
        n.key = `${liveryKey(c.livery)}|${c.livery.number}`;
        nodes.set(c.id, n);
        cars.addChild(n.root);
        placeLabel(n);
      }
      n.car = c;
      const key = `${liveryKey(c.livery)}|${c.livery.number}`;
      if (key !== n.key) { // another pack was chosen, or the pack arrived after the first state
        n.key = key;
        n.body.texture = textureFor(c);
        n.label.text = String(c.num);
      }
      n.label.visible = false; // decided below, once every car is placed
      const gone = c.status === "RETIRED" || c.status === "FINISHED";
      n.root.visible = !gone;
      if (gone) continue;
      sampleOutline(outline, store.lapFrac(c, now), placed);
      n.root.position.set(placed.x, placed.y);
      n.body.rotation = placed.heading;
      n.root.alpha = c.status === "IN_PIT" ? 0.5 : 1;
    }
    declutter(model.cars.filter((c) => (mine.has(c.id) || c.position <= 3) && nodes.get(c.id)?.root.visible).sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.position - b.position).map((c) => nodes.get(c.id)!), labelScale);
    const scFrac = store.safetyCarFrac(now);
    scCar.visible = scFrac !== null;
    if (scFrac !== null) {
      sampleOutline(outline, scFrac, placed);
      scCar.position.set(placed.x, placed.y);
      scCar.rotation = placed.heading;
      scText.rotation = -placed.heading; // the mark stays upright
    }
    cpu.add(performance.now() - t0);
    window.__undercutScene = { fps: meter.fps, cpuMs: cpu.mean, meanMs: meter.mean, p95Ms: meter.p95, cars: nodes.size };
  });
  return () => textures.forEach((t) => t.destroy(true));
}

