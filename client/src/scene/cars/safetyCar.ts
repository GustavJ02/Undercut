/** The safety car's art: a generic yellow sports coupe seen from the side, with a roof light bar that flashes orange. Original shapes,
 * not a copy of any real car and with no marks on it. Units are car lengths, as in `side.ts`: it faces +x, wheels on y = 0, up is negative y. */
import { Container, Graphics } from "pixi.js";

const poly = (g: Graphics, pts: [number, number][], px: number, colour: number) => g.poly(pts.flatMap(([x, y]) => [x * px, y * px])).fill(colour);

/** The body, drawn at `px` pixels per car length. Its box is exactly x in [-0.5, 0.5] and y in [-0.3, 0], so the sprite's anchor (middle of
 * the bottom edge) is the origin of car units and the lights can be placed in the same units. */
export function safetyCarBody(px: number): Container {
  const root = new Container();
  const g = new Graphics();
  g.rect(-0.5 * px, -0.3 * px, px, 0.3 * px).fill({ color: 0x000000, alpha: 0 }); // fixes the texture's size
  // body: long bonnet, set-back cabin, fastback tail
  poly(g, [[-0.47, -0.045], [-0.485, -0.11], [-0.41, -0.15], [-0.28, -0.168], [-0.13, -0.205], [0.0, -0.212], [0.11, -0.165], [0.3, -0.128], [0.46, -0.092], [0.487, -0.06], [0.45, -0.04]], px, 0xf2c230);
  poly(g, [[-0.46, -0.06], [0.45, -0.06], [0.445, -0.04], [-0.47, -0.045]], px, 0x14171c); // sill
  poly(g, [[-0.2, -0.17], [-0.12, -0.195], [-0.01, -0.2], [0.075, -0.168]], px, 0x1b2330); // glass
  poly(g, [[0.4, -0.1], [0.462, -0.09], [0.47, -0.078], [0.4, -0.084]], px, 0xfff4c2); // headlamp
  poly(g, [[-0.482, -0.105], [-0.468, -0.085], [-0.455, -0.1]], px, 0xd9302a); // tail lamp
  poly(g, [[-0.42, -0.148], [-0.34, -0.16], [-0.34, -0.15], [-0.42, -0.138]], px, 0x14171c); // spoiler lip
  for (const x of [0.3, -0.3]) {
    g.circle(x * px, -0.07 * px, 0.074 * px).fill(0x12151a);
    g.circle(x * px, -0.07 * px, 0.04 * px).fill(0xb9c1cf);
    g.circle(x * px, -0.07 * px, 0.014 * px).fill(0x3a4152);
  }
  root.addChild(g);
  return root;
}

const BAR = { x0: -0.105, x1: 0.065, top: -0.262, bottom: -0.215 };

/** The light bar on the roof. `lit` is which half is on: 0 left, 1 right, 2 both (steady, for reduced motion). */
export function drawSafetyLights(g: Graphics, px: number, lit: 0 | 1 | 2): void {
  g.clear();
  const mid = (BAR.x0 + BAR.x1) / 2;
  g.roundRect(BAR.x0 * px, BAR.top * px, (BAR.x1 - BAR.x0) * px, (BAR.bottom - BAR.top) * px, 0.006 * px).fill(0x14171c);
  for (const [i, [a, b]] of ([[BAR.x0 + 0.006, mid - 0.003], [mid + 0.003, BAR.x1 - 0.006]] as const).entries()) {
    const on = lit === 2 || lit === i;
    if (on) {
      const cx = ((a + b) / 2) * px, cy = ((BAR.top + BAR.bottom) / 2) * px;
      g.circle(cx, cy, 0.13 * px).fill({ color: 0xff9a1f, alpha: 0.16 });
      g.circle(cx, cy, 0.075 * px).fill({ color: 0xffb347, alpha: 0.32 });
    }
    g.rect(a * px, (BAR.top + 0.005) * px, (b - a) * px, (BAR.bottom - BAR.top - 0.01) * px).fill(on ? 0xffb347 : 0x5b3510);
  }
}
