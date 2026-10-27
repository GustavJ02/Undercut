/** The pit-wall scene art, drawn once in design space (see `layout.ts`): dusk sky, hills, grandstand, fence, track, pit lane, pit wall
 * and the desk with its monitor bezels. Flat vector with soft gradients; every shape here is original and generic, with no real
 * circuit, team or sponsor imagery (the ad boards carry abstract stripes, not marks). Layers have a depth: far layers move less
 * when the camera moves, which is the only parallax this scene has. */
import { Container, FillGradient, Graphics } from "pixi.js";
import { POSES, type Pose } from "./camera";
import { BEZEL, DESK_TOP, DROP, MONITORS, type Rect } from "./layout";

/** The five start lamps on the gantry over the line (drawn by the effects layer, which lights them). */
export const LAMPS = Array.from({ length: 5 }, (_, i) => ({ x: 1500 - 12 + i * 14, y: 117 }));

const X0 = -1500, X1 = 5400; // wide enough for any window shape at the fit scale
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const vgrad = (stops: [number, number][]) => new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: stops.map(([offset, color]) => ({ offset, color })), textureSpace: "local" });

export interface Layer {
  c: Container;
  depth: number; // 1 moves with the camera, near 0 hardly moves
}

export interface Backdrop {
  root: Container;
  layers: Layer[];
  setMonitors(mode: "race" | "briefing" | "none"): void;
  /** Fade the monitor bezels (0 at the landing shot, 1 at the pit wall) so empty screens are not seen while the camera is far. */
  setBezelAlpha(a: number, lookT?: number): void;
  /** The camera has dropped by `drop` (0..1): the race monitors are taller by that share of `DROP`. */
  setDrop(drop: number): void;
  /** Where the people go: `lane` in the pit lane, `wall` behind the pit wall, which covers their legs. */
  people: { lane: Container; wall: Container };
  /** Cars passing on the track and rolling through the pit lane (side view), and the effects: marshal flags, track sheen, gantry lamps, ambient tint and rain. */
  cars: { track: Container; lane: Container };
  fx: { flags: Container; sheen: Container; gantry: Container; tint: Container; rain: Container };
  applyParallax(pose: Pose): void;
}

function sky(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(X0, -1700, X1 - X0, 2000).fill(vgrad([[0, 0x070b1f], [0.55, 0x1d1a45], [0.82, 0x5a3a6a], [1, 0xe58a5c]]));
  const r = rng(7);
  for (let i = 0; i < 160; i++) g.circle(X0 + r() * (X1 - X0), -1500 + r() * 1500, 0.6 + r() * 1.1).fill({ color: 0xffffff, alpha: 0.25 + r() * 0.6 });
  g.ellipse(1500, 250, 900, 90).fill({ color: 0xffb36b, alpha: 0.25 }); // glow at the horizon
  c.addChild(g);
  return c;
}

function hills(): Container {
  const c = new Container();
  const g = new Graphics();
  const ridge = (base: number, amp: number, seed: number, colour: number) => {
    const r = rng(seed);
    const pts: number[] = [X0, 330];
    for (let x = X0; x <= X1; x += 90) pts.push(x, base - amp * (0.5 + 0.5 * Math.sin(x / 260 + seed) * (0.6 + 0.4 * r())));
    pts.push(X1, 330);
    g.poly(pts).fill(colour);
  };
  g.rect(X0, 300, X1 - X0, 1500).fill(0x1a1c3d); // an underlay: parallax shifts layers against each other, and nothing may show through
  ridge(230, 60, 3, 0x2a2650);
  ridge(250, 40, 11, 0x1a1c3d);
  c.addChild(g);
  return c;
}

const CROWD = [0x8a5a4a, 0x3d5a80, 0xb0836a, 0x5c7a5c, 0x7d6a9a, 0xc9b27c, 0x9a4a5a, 0x4a6a86];

function grandstand(): Container {
  const c = new Container();
  const g = new Graphics();
  const x0 = 120, x1 = 1800;
  g.rect(X0, 272, X1 - X0, 1500).fill(0x15171f); // underlay, see hills()
  g.rect(x0, 132, x1 - x0, 140).fill(vgrad([[0, 0x2b2d42], [1, 0x15171f]]));
  const r = rng(21);
  for (let row = 0; row < 9; row++) {
    const y = 152 + row * 12.5;
    g.rect(x0, y + 9, x1 - x0, 2).fill({ color: 0x000000, alpha: 0.35 });
    for (let x = x0 + 4; x < x1 - 8; x += 9.5) if (r() > 0.18) g.roundRect(x, y, 6, 8, 2).fill({ color: CROWD[Math.floor(r() * CROWD.length)], alpha: 0.85 });
  }
  g.poly([x0 - 30, 138, x1 + 30, 138, x1 - 10, 112, x0 + 10, 112]).fill(0x1d2030); // roof
  g.rect(x0 - 30, 138, x1 - x0 + 60, 4).fill(0x3b4160);
  for (const x of [x0 + 60, x1 - 60]) { // floodlight towers, kept to the ends so the landing title has clear sky
    g.rect(x - 3, 20, 6, 120).fill(0x2a2d3b);
    g.roundRect(x - 34, 8, 68, 16, 4).fill(0x20232f);
    for (let i = 0; i < 5; i++) g.circle(x - 26 + i * 13, 16, 4).fill(0xfff2c9);
    g.ellipse(x, 18, 90, 34).fill({ color: 0xfff2c9, alpha: 0.09 });
  }
  c.addChild(g);
  return c;
}

function fence(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(X0, 286, X1 - X0, 1500).fill(0x14161f); // underlay
  g.rect(X0, 272, X1 - X0, 14).fill(vgrad([[0, 0x252938], [1, 0x14161f]]));
  const boards = [0xb8c4d6, 0x4a6fa5, 0xd9a441, 0x6a4a8c, 0x3f8f7a, 0xc9573f]; // generic colour fields with abstract stripes: no marks
  for (let x = 120, i = 0; x < 1800; x += 120, i++) {
    g.roundRect(x, 273, 110, 12, 2).fill(boards[i % boards.length]);
    g.rect(x + 10, 277, 60, 4).fill({ color: 0xffffff, alpha: 0.55 });
    g.rect(x + 78, 275, 6, 8).fill({ color: 0x000000, alpha: 0.35 });
  }
  g.rect(X0, 252, X1 - X0, 2).fill({ color: 0x9aa4b8, alpha: 0.5 });
  for (let x = X0; x < X1; x += 40) g.rect(x, 252, 2, 21).fill({ color: 0x9aa4b8, alpha: 0.45 });
  for (let y = 258; y < 272; y += 7) g.rect(X0, y, X1 - X0, 1).fill({ color: 0x9aa4b8, alpha: 0.2 });
  c.addChild(g);
  return c;
}

function track(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(X0, 352, X1 - X0, 1500).fill(0x23272f); // underlay
  g.rect(X0, 286, X1 - X0, 66).fill(vgrad([[0, 0x2d323d], [1, 0x23272f]]));
  g.rect(X0, 288, X1 - X0, 2).fill({ color: 0xe6e9ef, alpha: 0.8 });
  g.rect(X0, 348, X1 - X0, 2).fill({ color: 0xe6e9ef, alpha: 0.8 });
  for (let x = X0, i = 0; x < X1; x += 36, i++) g.rect(x, 350, 36, 4).fill(i % 2 ? 0xcfd3dc : 0xa83a3a); // kerb
  for (let x = X0; x < X1; x += 120) g.rect(x, 318, 56, 2).fill({ color: 0xe6e9ef, alpha: 0.28 });
  for (let i = 0; i < 6; i++) g.rect(X0 + 300 + i * 1000, 330, 220, 10).fill({ color: 0x000000, alpha: 0.12 }); // rubber
  const sx = 1500; // start / finish line
  for (let y = 290, k = 0; y < 348; y += 6, k++) for (let j = 0; j < 2; j++) g.rect(sx + j * 6, y, 6, 6).fill((k + j) % 2 ? 0xe6e9ef : 0x15171f);
  g.rect(sx - 20, 120, 6, 166).fill(0x2a2d3b); // gantry
  g.rect(sx + 34, 120, 6, 166).fill(0x2a2d3b);
  g.roundRect(sx - 26, 100, 72, 34, 4).fill(0x1b1e2a);
  c.addChild(g);
  return c;
}

function pitlane(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(X0, 394, X1 - X0, 1500).fill(0x2f343e); // underlay
  g.rect(X0, 354, X1 - X0, 40).fill(vgrad([[0, 0x3a404b], [1, 0x2f343e]]));
  for (let x = X0; x < X1; x += 50) g.rect(x, 364, 28, 3).fill({ color: 0xf2c230, alpha: 0.85 }); // speed-limit line
  g.rect(X0, 386, X1 - X0, 2).fill({ color: 0xe6e9ef, alpha: 0.5 });
  c.addChild(g);
  return c;
}

function pitwall(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(X0, 412, X1 - X0, 1500).fill(0x434956); // underlay
  g.rect(X0, 394, X1 - X0, 18).fill(vgrad([[0, 0x6b7280], [1, 0x434956]]));
  g.rect(X0, 394, X1 - X0, 2).fill(0xaab1bf);
  for (const x of [100, 520, 840, 1180, 1700, 2100, 2500, 2900, 3300]) { // radio masts and a lamp on the wall, placed clear of where people stand
    g.rect(x, 340, 3, 56).fill(0x20232f);
    g.circle(x + 1.5, 338, 4).fill({ color: 0xff6a4a, alpha: 0.9 });
    g.circle(x + 1.5, 338, 14).fill({ color: 0xff6a4a, alpha: 0.12 });
  }
  g.rect(X0, 408, X1 - X0, 6).fill({ color: 0x000000, alpha: 0.4 });
  c.addChild(g);
  return c;
}

const bezel = (g: Graphics, r: Rect) => {
  g.roundRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, 16).fill({ color: 0x000000, alpha: 0.45 });
  g.roundRect(r.x, r.y, r.w, r.h, 12).fill(0x0a0c11).stroke({ color: 0x2f3746, width: 2 });
  g.roundRect(r.x + BEZEL - 2, r.y + BEZEL - 2, r.w - 2 * BEZEL + 4, r.h - 2 * BEZEL + 4, 6).fill(0x05070a);
};

const taller = (r: Rect, drop: number): Rect => ({ ...r, h: r.h + drop * DROP });

function desk(): { c: Container; race: Graphics; briefing: Graphics; strategy: Graphics; redraw: (drop: number) => void } {
  const c = new Container();
  const top = new Graphics();
  top.rect(X0, DESK_TOP, X1 - X0, 1700).fill(vgrad([[0, 0x1b212c], [0.06, 0x131820], [1, 0x090b10]]));
  top.rect(X0, DESK_TOP, X1 - X0, 2).fill(0x3a4456);
  top.rect(X0, DESK_TOP + 2, X1 - X0, 8).fill({ color: 0x6aa7ff, alpha: 0.07 }); // monitor glow along the desk edge
  const race = new Graphics();
  const briefing = new Graphics();
  bezel(briefing, MONITORS.briefing);
  const strategy = new Graphics();
  const redraw = (drop: number) => {
    race.clear();
    for (const r of [MONITORS.tower, MONITORS.map, MONITORS.ops]) bezel(race, taller(r, drop));
    strategy.clear();
    bezel(strategy, taller(MONITORS.strategy, drop));
  };
  redraw(0);
  c.addChild(top, race, briefing, strategy);
  return { c, race, briefing, strategy, redraw };
}

export function buildBackdrop(): Backdrop {
  const root = new Container();
  const d = desk();
  const people = { lane: new Container(), wall: new Container() };
  const cars = { track: new Container(), lane: new Container() };
  const fx = { flags: new Container(), sheen: new Container(), gantry: new Container(), tint: new Container(), rain: new Container() };
  const layers: Layer[] = [
    { c: sky(), depth: 0.05 },
    { c: hills(), depth: 0.12 },
    { c: grandstand(), depth: 0.3 },
    { c: fence(), depth: 0.55 },
    { c: fx.flags, depth: 0.55 },
    { c: track(), depth: 0.75 },
    { c: fx.sheen, depth: 0.75 },
    { c: fx.gantry, depth: 0.75 },
    { c: cars.track, depth: 0.75 },
    { c: pitlane(), depth: 0.9 },
    { c: cars.lane, depth: 0.9 },
    { c: people.lane, depth: 0.9 },
    { c: people.wall, depth: 1 },
    { c: pitwall(), depth: 1 },
    { c: fx.tint, depth: 1 },
    { c: fx.rain, depth: 1 },
    { c: d.c, depth: 1 },
  ];
  for (const l of layers) root.addChild(l.c);
  const ref = POSES.pitwall;
  let shown = 0;
  return {
    root,
    layers,
    people,
    cars,
    fx,
    setMonitors(mode) {
      d.race.visible = mode === "race";
      d.briefing.visible = mode === "briefing";
      d.strategy.visible = mode === "race";
    },
    setBezelAlpha(a, lookT = 1) {
      d.race.alpha = a;
      d.briefing.alpha = a;
      d.strategy.alpha = a * Math.min(lookT * 5, 1);       // the strategy screen is only there once the camera is turning to it
    },
    setDrop(drop) {
      if (drop !== shown) d.redraw((shown = drop));
    },
    applyParallax(pose) {
      for (const l of layers) l.c.position.set((pose.fx - ref.fx) * (1 - l.depth), (pose.fy - ref.fy) * (1 - l.depth));
    },
  };
}
