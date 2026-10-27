/** The signals of the scene, drawn from the render model: the start lights on the gantry, marshal flags, an ambient tint for the
 * flag state, rain and a wet sheen on the track. The logic is pure (`state.ts`); this draws it. Reads the model and its cues only. */
import { Container, Graphics, Text } from "pixi.js";
import { LAMPS } from "../pitwall/backdrop";
import type { ModelStore } from "../../render/store";
import { startSeq } from "../../startSequence";
import { BLUE_HOLD_S, GREEN_SHOW_S, boardState, type Board, dropY, flagFor, gantryState, makeDrops, tintFor, trackSheen, wave, type FlagColour, type LampColour } from "./state";

interface Layers {
  flags: Container;
  sheen: Container;
  gantry: Container;
  tint: Container;
  rain: Container;
}

const LAMP = { off: 0x2a1a1e, red: 0xff3b30, amber: 0xffb020, green: 0x35e07a } as const;
const FLAG = { yellow: 0xf2c230, red: 0xe8334a } as const;
const FLAG_XS = Array.from({ length: 26 }, (_, i) => 90 + i * 150); // the marshal posts go on past the strategy screen
/** LED boards beside every third marshal post: dark when idle, lit for the safety car, the VSC, their ends and blue flags. */
const BOARD_POSTS = [1, 4, 7, 10, 13, 16, 19, 22];
const BOARD = { dx: 34, y: 214, w: 112, h: 46 };
const RAIN = { x0: -200, x1: 4400, y0: -100, y1: 412 };

export class SceneFx {
  private store: ModelStore | null = null;
  private cursor = 0;
  private greenAt: number | null = null;
  private lightsOutAt: number | null = null;
  private session = "";
  private gantry = new Graphics();
  private flags = new Graphics();
  private tint = new Graphics();
  private sheen = new Graphics();
  private rain = new Graphics();
  private drops = makeDrops(340, RAIN.x1 - RAIN.x0, RAIN.y1 - RAIN.y0);
  private lampKey = "";
  private tintKey = "";
  private flagAlpha = 0;
  private flagKind: FlagColour = "none";
  private tintAlpha = 0;
  private rainAlpha = 0;
  private sheenAlpha = 0;
  private last = 0;
  private reduced: boolean;
  private boards = new Graphics();
  private boardTexts: [Text, Text][] = [];
  private boardKey = "";
  private blue: { num: number; until: number } | null = null;

  constructor(l: Layers) {
    l.gantry.addChild(this.gantry);
    l.flags.addChild(this.boards);
    l.flags.addChild(this.flags);
    this.drawBoards(null, false);
    l.tint.addChild(this.tint);
    l.sheen.addChild(this.sheen);
    l.rain.addChild(this.rain);
    this.sheen.rect(-1500, 286, 4920, 108).fill({ color: 0x9ab8e0, alpha: 1 });
    this.sheen.alpha = 0;
    this.reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  attach(store: ModelStore | null): void {
    this.store = store;
    this.cursor = store ? store.cueEnd : 0;
    if (!store) this.reset();
  }

  private reset() {
    this.greenAt = this.lightsOutAt = null;
    this.session = "";
    this.flagAlpha = this.tintAlpha = this.rainAlpha = this.sheenAlpha = 0;
    this.lampKey = this.tintKey = "";
    this.flags.clear();
    this.rain.clear();
    this.tint.clear();
    this.sheen.alpha = 0;
    this.drawLamps("off", [false, false, false, false, false]);
    this.blue = null;
    this.drawBoards(null, false);
  }

  private drawLamps(colour: LampColour, lit: boolean[]) {
    const key = colour + lit.join();
    if (key === this.lampKey) return;
    this.lampKey = key;
    this.gantry.clear();
    LAMPS.forEach((p, i) => {
      if (lit[i] && colour !== "off") this.gantry.circle(p.x, p.y, 10).fill({ color: LAMP[colour], alpha: 0.2 });
      this.gantry.circle(p.x, p.y, 4.5).fill(lit[i] && colour !== "off" ? LAMP[colour] : LAMP.off);
    });
  }

  private drawFlags(kind: FlagColour, alpha: number, t: number) {
    const g = this.flags;
    g.clear();
    if (kind === "none" || alpha < 0.02) return;
    FLAG_XS.forEach((x, i) => {
      g.rect(x - 1, 224, 2, 30).fill({ color: 0x9aa4b8, alpha });
      const w = this.reduced ? 0 : wave(i, t);
      if (kind === "chequered") {
        for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) g.rect(x + 1 + c * 5, 225 + r * 5 + (this.reduced ? 0 : wave(i + c * 0.4, t, 1.5)), 5, 5).fill({ color: (r + c) % 2 ? 0xe6e9ef : 0x15171f, alpha });
      } else {
        g.poly([x + 1, 225, x + 28, 225 + w * 0.5, x + 27, 238 + w, x + 1, 238]).fill({ color: FLAG[kind], alpha });
      }
    });
  }

  private drawBoards(b: Board | null, lit: boolean) {
    const key = b ? `${b.lines.join("|")}${b.colour}${lit}` : `off${lit}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    const g = this.boards;
    g.clear();
    BOARD_POSTS.forEach((p, i) => {
      const x = FLAG_XS[p] + BOARD.dx;
      g.rect(x + BOARD.w / 2 - 2, BOARD.y + BOARD.h, 4, 30).fill(0x4a5163);
      g.roundRect(x - 3, BOARD.y - 3, BOARD.w + 6, BOARD.h + 6, 5).fill(0x1b1f29);
      g.roundRect(x, BOARD.y, BOARD.w, BOARD.h, 3).fill(0x0a0c11);
      if (b && lit) g.roundRect(x - 8, BOARD.y - 8, BOARD.w + 16, BOARD.h + 16, 10).fill({ color: b.colour, alpha: 0.18 });
      if (!this.boardTexts[i]) {
        const mk = () => {
          const t = new Text({ text: "", style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: "700", fontSize: 20, letterSpacing: 2, fill: 0xffffff } });
          t.anchor.set(0.5);
          this.boards.parent?.addChild(t);
          return t;
        };
        this.boardTexts[i] = [mk(), mk()];
      }
      const [a, c] = this.boardTexts[i];
      const two = !!b && b.lines.length === 2;
      a.text = b?.lines[0] ?? "";
      c.text = (b?.lines as string[] | undefined)?.[1] ?? "";
      a.style.fontSize = two ? 17 : 26;
      c.style.fontSize = 11;
      c.style.letterSpacing = 1;
      a.position.set(x + BOARD.w / 2, BOARD.y + (two ? 15 : 23));
      c.position.set(x + BOARD.w / 2, BOARD.y + 34);
      for (const t of [a, c]) {
        t.style.fill = b ? b.colour : 0xffffff;
        t.alpha = b && lit ? 1 : 0;
      }
    });
  }

  update(nowMs: number): void {
    const store = this.store;
    const m = store?.model;
    if (!store || !m) return;
    const now = nowMs / 1000;
    const dt = this.last ? Math.min(now - this.last, 0.1) : 0.016;
    this.last = now;

    const { cues, next } = store.cuesSince(this.cursor);
    this.cursor = next;
    for (const c of cues) {
      if (c.type === "greenFlag" || c.type === "restart") this.greenAt = now;
      if (c.type === "lightsOut") this.lightsOutAt = now;
    }
    if (this.session === "GRID" && m.session !== "GRID") this.lightsOutAt = now; // the start, as the audio sees it
    this.session = m.session;
    if (this.greenAt !== null && now - this.greenAt > GREEN_SHOW_S + 1) this.greenAt = null;

    const g = gantryState({ session: m.session, lighting: m.lighting, now, greenAt: this.greenAt, lightsOutAt: this.lightsOutAt, startLit: startSeq.lit() });
    this.drawLamps(g.colour, g.lit);

    // LED boards; a blue flag is kept up for a moment once the lapping car has gone by
    const lapped = m.blue[0] ? m.cars.find((c) => c.id === m.blue[0].lapped) : undefined;
    if (lapped) this.blue = { num: lapped.num, until: now + BLUE_HOLD_S };
    else if (this.blue && now > this.blue.until) this.blue = null;
    const board = boardState({ lighting: m.lighting, safetyEnding: m.safetyEnding, blueNum: this.blue?.num ?? null, now, reduced: this.reduced });
    this.drawBoards(board, !!board && board.lit);

    // flags fade in and out with the flag state
    const kind = flagFor(m.lighting);
    if (kind !== "none") this.flagKind = kind;
    this.flagAlpha += ((kind === "none" ? 0 : 1) - this.flagAlpha) * Math.min(dt * 4, 1);
    this.drawFlags(this.flagKind, this.flagAlpha, now);

    // ambient tint for the flag state and for rain
    const tint = tintFor(m.lighting, m.weather.raining);
    const key = String(tint.colour);
    this.tintAlpha += (tint.alpha - this.tintAlpha) * Math.min(dt * 3, 1);
    if (key !== this.tintKey) {
      this.tintKey = key;
      this.tint.clear().rect(-1500, -1200, 4920, 1612).fill(tint.colour);
    }
    this.tint.alpha = this.tintAlpha;

    // the track's wet sheen follows its state, rain only while it falls
    this.sheenAlpha += (trackSheen(m.weather.track) - this.sheenAlpha) * Math.min(dt * 1.5, 1);
    this.sheen.alpha = this.sheenAlpha * 0.25;
    this.rainAlpha += ((m.weather.raining ? 1 : 0) - this.rainAlpha) * Math.min(dt * 1.2, 1);
    this.drawRain(now);
  }

  private drawRain(now: number) {
    const g = this.rain;
    g.clear();
    if (this.rainAlpha < 0.03) return;
    const h = RAIN.y1 - RAIN.y0;
    const t = this.reduced ? 0 : now;
    for (const d of this.drops) {
      const y = dropY(d, t, h) + RAIN.y0;
      g.moveTo(RAIN.x0 + d.x, y).lineTo(RAIN.x0 + d.x - d.len * 0.22, y + d.len);
    }
    g.stroke({ color: 0xbcd2f0, width: 1.2, alpha: 0.5 * this.rainAlpha });
  }
}
