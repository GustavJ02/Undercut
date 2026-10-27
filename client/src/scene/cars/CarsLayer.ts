/** The cars of the pit-wall scene in side view: cars sweeping past on the main straight with a motion-blur streak, cars rolling through
 * the pit lane to their box, and the safety car ahead of the leader. Reads only the render model. Positions are in `lane.ts`. */
import { Assets, Container, Graphics, Sprite, Text, type Renderer, type Texture } from "pixi.js";
import type { Compound } from "../../contract/types";
import type { RenderCar } from "../../render/model";
import type { ModelStore } from "../../render/store";
import { drawShapes } from "../draw";
import { liveryKey } from "../livery";
import { drawSafetyLights, safetyCarBody } from "./safetyCar";
import { OFF_LEFT, OFF_RIGHT, SWAP_AT, anchoredX, boxX, carScale, gridness, lanePhase, laneX, pxPerLap, rawX, trackX } from "./lane";
import { drawTyreRings } from "./rings";
import { BODY_SIDE, NUMBER_AT, PARTS_SIDE, PATTERN_SIDE } from "./side";

const TEX_UNITS = 220; // texture size of one car length
const TRACK_LEN = 190, TRACK_Y = 340; // design px: car length and the y of its wheels on the track
const LANE_LEN = 210, LANE_Y = 384;
const GHOSTS = [0.32, 0.2, 0.1];
const hex = (c: string) => parseInt(c.slice(1), 16);

/** The largest step back, in px, that is taken for the estimate catching up and not for a lap wrap. */
const BACK_HOLD_PX = 600;

class Node {
  root = new Container();
  ghosts: Sprite[];
  main: Sprite;
  prevX: number | null = null;
  where: "track" | "lane" | null = null;
  texKey = "";
  /** Lap fraction of the car's slot on the grid while it is still drawn from there (see `anchoredX`), else null. */
  slot: number | null = null;
  /** The ring on the wheels: its compound, and the drawn state (to redraw only on a change). */
  ring = new Graphics();
  ringShown: Compound | null | undefined = undefined;
  compound: Compound | null = null;

  constructor(tex: Texture) {
    this.ghosts = GHOSTS.map((a) => {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.alpha = a;
      return s;
    });
    this.main = new Sprite(tex);
    this.main.anchor.set(0.5, 1);
    this.root.addChild(...this.ghosts, this.main, this.ring);
  }

  setTexture(tex: Texture) {
    for (const s of [...this.ghosts, this.main]) s.texture = tex;
  }
}

export class CarsLayer {
  private store: ModelStore | null = null;
  private nodes = new Map<string, Node>();
  private textures = new Map<string, Texture>();
  private sc: Node | null = null;
  private scLights: Graphics | null = null;
  private scLit = -1;
  private scTexture: Texture | null = null;
  private reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private images = new Map<string, Texture | null>(); // a pack's livery overlays: a texture when loaded, null when they failed
  private loading = new Set<string>();
  private fitting = new Map<string, Compound>(); // the set going on in each car's stop, known from pit in, shown when the work is done
  private last = 0;
  private cursor = 0;
  private lastSession = "";
  private launchSim: number | null = null; // sim time of the last lights out or restart seen

  constructor(private renderer: Renderer, private track: Container, private lane: Container) {
    track.sortableChildren = true;
  }

  attach(store: ModelStore | null): void {
    this.store = store;
    this.cursor = store ? store.cueEnd : 0;
    this.launchSim = null;
    this.lastSession = "";
    if (!store) this.clear();
  }

  private clear() {
    for (const n of this.nodes.values()) n.root.destroy({ children: true });
    this.nodes.clear();
    this.sc?.root.destroy({ children: true });
    this.sc = null;
    this.scLights = null;
    this.scLit = -1;
    this.scTexture?.destroy(true);
    this.scTexture = null;
    this.textures.forEach((t) => t.destroy(true));
    this.textures.clear();
    for (const url of this.images.keys()) void Assets.unload(url).catch(() => undefined);
    this.images.clear();
    this.loading.clear();
  }

  /** A livery overlay image: not there until loaded (the car is drawn without it), and left out for good if it fails. */
  private imageFor(url?: string): Texture | null {
    if (!url) return null;
    const known = this.images.get(url);
    if (known !== undefined) return known;
    if (!this.loading.has(url)) {
      this.loading.add(url);
      Assets.load<Texture>(url).then((t) => this.images.set(url, t), (e) => {
        console.warn(`[undercut] could not load the livery image ${url}`, e);
        this.images.set(url, null);
      });
    }
    return null;
  }

  private textureFor(key: string, l: { primary: string; secondary: string; accent: string; pattern: RenderCar["livery"]["pattern"]; number: number | string; helmet?: string }, image: Texture | null = null): Texture {
    const k = `${key}|${liveryKey(l)}|${l.number}|${image ? "img" : ""}`;
    let t = this.textures.get(k);
    if (!t) {
      const px = TEX_UNITS;
      const c = { primary: hex(l.primary), secondary: hex(l.secondary), accent: hex(l.accent), dark: 0x12151a, helmet: hex(l.helmet ?? l.secondary) };
      const g = new Graphics();
      g.poly(BODY_SIDE.flatMap(([x, y]) => [x * px, y * px])).fill(c.primary);
      drawShapes(g, PATTERN_SIDE[l.pattern] ?? [], (s) => c[s], px); // an unknown pattern draws as solid
      const parts: Container[] = [g];
      if (image) { // the pack's overlay, fitted to the body and clipped to its outline
        const body = new Graphics();
        body.poly(BODY_SIDE.flatMap(([x, y]) => [x * px, y * px])).fill(0xffffff);
        const o = new Sprite(image);
        o.position.set(-0.44 * px, -0.255 * px);
        o.width = 0.91 * px;
        o.height = 0.215 * px;
        o.mask = body;
        parts.push(body, o);
      }
      g.poly(BODY_SIDE.flatMap(([x, y]) => [x * px, y * px])).stroke({ color: 0x000000, width: 1.2, alpha: 0.5 });
      drawShapes(g, PARTS_SIDE, (s) => c[s], px);
      const label = new Text({ text: String(l.number), style: { fontSize: 22, fontFamily: "system-ui, sans-serif", fontWeight: "800", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 2 });
      label.anchor.set(0.5);
      label.position.set(NUMBER_AT.x * px, NUMBER_AT.y * px);
      const root = new Container();
      root.addChild(...parts, label);
      t = this.renderer.generateTexture({ target: root, resolution: 2 });
      root.destroy({ children: true });
      this.textures.set(k, t);
    }
    return t;
  }

  private place(n: Node, where: "track" | "lane", x: number, dt: number, moving: boolean, row = 0, size = 1) {
    if (n.where !== where) {
      (where === "track" ? this.track : this.lane).addChild(n.root);
      n.where = where;
      n.prevX = null;
    }
    const len = where === "track" ? TRACK_LEN : LANE_LEN;
    const scale = (len / TEX_UNITS) * size;
    n.root.visible = true;
    n.root.position.set(x, (where === "track" ? TRACK_Y : LANE_Y) + row);
    let v = 0;
    if (moving && n.prevX !== null && dt > 0 && Math.abs(x - n.prevX) < 700) v = (x - n.prevX) / dt;
    n.prevX = x;
    const streak = Math.min(Math.max(v, 0) * 0.016, 70);
    n.ghosts.forEach((s, i) => {
      s.scale.set(scale);
      s.x = -streak * (i + 1);
      s.visible = streak > 2;
    });
    n.main.scale.set(scale * (1 + Math.min(Math.max(v, 0) / 14000, 0.14)), scale);
    n.ring.scale.set(n.main.scale.x, scale); // stretched with the car, so the rings stay on the wheels
  }

  /** Show a compound on the wheels; `track` records it as the one the car carries into its next stop. */
  private setRing(n: Node, compound: Compound, track: boolean) {
    if (track) n.compound = compound;
    if (n.ringShown === compound) return;
    n.ringShown = compound;
    drawTyreRings(n.ring, TEX_UNITS, compound);
  }

  update(now: number): void {
    const store = this.store;
    const m = store?.model;
    if (!store || !m) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0.016;
    this.last = now;
    const sim = store.simNow(now);
    const { cues, next } = store.cuesSince(this.cursor);
    this.cursor = next;
    for (const c of cues) {
      if (c.type === "lightsOut" || c.type === "restart") this.launchSim = m.t;
      if (c.type === "pitIn" && c.car && c.compound) this.fitting.set(c.car, c.compound);
    }
    // a snapshot after the start carries lights out as history, not as a cue: the end of the grid session is the start too
    if (this.lastSession === "GRID" && m.session !== "GRID") this.launchSim = m.t;
    this.lastSession = m.session;
    const px = pxPerLap(m.session, this.launchSim === null ? null : sim - this.launchSim);
    const grid = gridness(px);
    const own = m.cars.find((c) => c.id === m.mine[0])?.teamId ?? "";
    for (const c of m.cars) {
      let n = this.nodes.get(c.id);
      const image = this.imageFor(c.livery.image);
      if (!n) {
        n = new Node(this.textureFor(c.id, c.livery, image));
        n.texKey = `${liveryKey(c.livery)}|${c.livery.number}|${image ? "img" : ""}`;
        this.nodes.set(c.id, n);
      }
      const want = `${liveryKey(c.livery)}|${c.livery.number}|${image ? "img" : ""}`;
      if (n.texKey !== want) { // the pack changed, or the overlay has loaded
        n.texKey = want;
        n.setTexture(this.textureFor(c.id, c.livery, image));
      }
      if (c.status === "RETIRED" || c.status === "FINISHED") {
        n.root.visible = false;
        continue;
      }
      if (c.status === "IN_PIT") {
        const since = m.pitLane.find((p) => p.car === c.id)?.sinceT ?? sim;
        const e = sim - since;
        if (lanePhase(e) === "gone") {
          n.root.visible = false;
          continue;
        }
        // the old ring until the crew has finished, then the new set
        this.setRing(n, e >= SWAP_AT ? this.fitting.get(c.id) ?? c.compound : n.compound ?? c.compound, false);
        this.place(n, "lane", laneX(e, boxX(c.teamId, own)), dt, false);
        continue;
      }
      this.fitting.delete(c.id);
      this.setRing(n, c.compound, true);
      const frac = store.lapFrac(c, now);
      if (m.session === "GRID") n.slot = frac;
      let x: number | null;
      if (n.slot !== null) {
        // drawn from its grid slot until it is out of sight; the real position takes over only once it is out of sight in the real scale too
        const ax = anchoredX(n.slot, frac, px);
        const real = rawX(frac);
        if (ax > OFF_RIGHT && (real > OFF_RIGHT || real < OFF_LEFT)) n.slot = null;
        x = ax > OFF_RIGHT ? null : ax;
        if (n.slot === null) x = trackX(frac); // released: the real scale, as rawX judged it
      } else x = trackX(frac, px);
      if (x === null) {
        n.root.visible = false;
        n.prevX = null;
        continue;
      }
      // cars do not drive backwards: a state that arrives slightly behind where the car was extrapolated to holds it in place (a lap wrap is a big step)
      if (n.where === "track" && n.prevX !== null && x < n.prevX && n.prevX - x < BACK_HOLD_PX) x = n.prevX;
      if (import.meta.env.DEV) (((window as unknown as Record<string, unknown>).__carsX ??= {}) as Record<string, number>)[c.id] = x; // for the launch check in scripts
      // the grid is two by two: every second car stands a little further from the camera
      this.place(n, "track", x, dt, true, c.position % 2 === 0 ? -9 * Math.max(grid, 0) : 0, carScale(grid));
      n.root.zIndex = c.position % 2 === 0 ? 0 : 1; // the near row of the grid is drawn over the far one
    }
    this.updateSafetyCar(store, now, dt);
  }

  /** Under the safety car a yellow car runs just ahead of the leader. */
  private updateSafetyCar(store: ModelStore, now: number, dt: number) {
    const m = store.model!;
    if (m.lighting !== "sc") {
      if (this.sc) this.sc.root.visible = false;
      return;
    }
    const frac = store.safetyCarFrac(now);
    if (frac === null) {
      if (this.sc) this.sc.root.visible = false; // in the pit: it comes out of the exit and goes in at the entry
      return;
    }
    if (!this.sc) {
      this.scTexture = this.renderer.generateTexture({ target: safetyCarBody(TEX_UNITS), resolution: 2 });
      this.sc = new Node(this.scTexture);
      this.scLights = new Graphics();
      this.sc.root.addChild(this.scLights);
    }
    const x = trackX(frac);
    if (import.meta.env.DEV) (((window as unknown as Record<string, unknown>).__carsX ??= {}) as Record<string, number>).SC = x ?? -99999;
    if (x === null) this.sc.root.visible = false;
    else {
      this.place(this.sc, "track", x, dt, true);
      // flashing orange lights, one half and then the other; the bar is in the sprite's units, so it scales with the car
      const lit = this.reduced ? 2 : (Math.floor(now / 140) % 2) as 0 | 1;
      if (lit !== this.scLit && this.scLights) {
        this.scLit = lit;
        drawSafetyLights(this.scLights, TEX_UNITS, lit);
      }
      this.scLights?.scale.set(this.sc.main.scale.y);
    }
  }
}
