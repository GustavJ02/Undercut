/** The Pixi rig for one character: legs, torso, two arms, a head and a prop, built from a `CharacterSpec` and moved by a `Pose`.
 * Everything is vector shapes drawn once; animating is setting rotations and offsets, so it costs almost nothing per frame. */
import { Container, Graphics } from "pixi.js";
import type { Pose } from "./poses";
import { anchors, type CharacterSpec } from "./spec";

const SIGN = { off: 0x454c58, red: 0xe0443a, green: 0x35c27a } as const;
const SHOE = 0x111419;

export class Character {
  root = new Container(); // at the feet; `hop` lifts it
  private rig = new Container();
  private legs = new Graphics();
  private torso = new Container();
  private armL = new Container();
  private armR = new Container();
  private head = new Container();
  private sign = new Graphics();
  private lastSign: Pose["sign"] | null = null;
  private a: ReturnType<typeof anchors>;

  constructor(private spec: CharacterSpec) {
    const s = spec;
    const a = (this.a = anchors(s));
    this.root.addChild(this.rig);
    this.rig.addChild(this.legs, this.torso);

    // legs and shoes, drawn standing; `squash` scales them toward the hips
    const lx = s.torsoW / 4;
    this.legs.roundRect(-lx - s.legW / 2, a.hipY, s.legW, -a.hipY, 1.5).fill(s.trousers);
    this.legs.roundRect(lx - s.legW / 2, a.hipY, s.legW, -a.hipY, 1.5).fill(s.trousers);
    this.legs.ellipse(-lx, -1, s.legW * 0.8, 2.2).fill(SHOE);
    this.legs.ellipse(lx, -1, s.legW * 0.8, 2.2).fill(SHOE);

    // torso at the hips: the body, a stripe, the collar
    const th = a.hipY - a.torsoTop;
    const body = new Graphics();
    body.roundRect(-s.torsoW / 2, -th, s.torsoW, th + 1, 4).fill(s.kit);
    body.rect(-s.torsoW / 2 + 1, -th * 0.62, s.torsoW - 2, 2.4).fill(s.trim);
    if (s.facing === "toward") body.rect(-0.5, -th + 2, 1, th - 4).fill({ color: 0x000000, alpha: 0.25 });
    else body.roundRect(-s.torsoW * 0.22, -th * 0.5, s.torsoW * 0.44, th * 0.22, 1.5).fill({ color: s.trim, alpha: 0.9 }); // a name plate on the back
    this.torso.addChild(body);

    // arms hang from the shoulders and rotate about them
    const arm = (side: -1 | 1, c: Container) => {
      c.position.set(side * a.shoulderX, a.torsoTop + 3 - a.hipY);
      const g = new Graphics();
      g.roundRect(-s.armW / 2, -1, s.armW, a.armLen * 0.72, s.armW / 2).fill(s.kit);
      g.rect(-s.armW / 2, a.armLen * 0.6, s.armW, 2).fill(s.trim);
      g.roundRect(-s.armW / 2 - 0.3, a.armLen * 0.72 - 2, s.armW + 0.6, a.armLen * 0.3, s.armW / 2).fill(s.skin);
      c.addChild(g);
      this.torso.addChild(c);
    };
    arm(-1, this.armL);
    arm(1, this.armR);
    this.addProp();

    // head
    this.head.position.set(0, a.headY - a.hipY);
    this.drawHead();
    this.torso.addChild(this.head);
  }

  private addProp() {
    const { prop, armW } = this.spec;
    const hand = this.a.armLen * 0.95;
    const g = new Graphics();
    if (prop === "gun") g.roundRect(-3, hand - 2, 6, 11, 2).fill(0x8e97a6).rect(-1, hand + 8, 2, 5).fill(0x31363f);
    if (prop === "jack") g.roundRect(-9, hand - 1, 18, 3.2, 1.5).fill(0x3b414c);
    if (prop === "lollipop") { // the pole is held upright beside the body; only the board changes
      const h = this.spec.height;
      const pole = new Graphics();
      const x = this.spec.torsoW * 0.5 + 10;
      pole.rect(x - 0.9, -h * 1.02, 1.8, h * 0.86).fill(0x2a2d36);
      this.sign.position.set(x, -h * 1.1);
      this.rig.addChild(pole, this.sign);
    }
    if (prop === "helmet") { // carried in the left hand
      const h = new Graphics();
      h.circle(0, hand + 5, 5.2).fill(this.spec.helmetColour).rect(-3.5, hand + 3, 7, 2.4).fill(0x14171c);
      this.armL.addChild(h);
    }
    void armW;
    if (g.getLocalBounds().width > 0) this.armR.addChild(g);
  }

  private drawHead() {
    const s = this.spec;
    const r = s.headR;
    const g = new Graphics();
    const toward = s.facing === "toward";
    g.roundRect(-r * 0.3, r * 0.6, r * 0.6, r * 0.9, 1.5).fill(s.skin); // neck
    g.circle(0, 0, r).fill(s.skin);
    if (toward) {
      g.circle(-r * 0.36, -r * 0.05, 0.9).fill(0x1b1410);
      g.circle(r * 0.36, -r * 0.05, 0.9).fill(0x1b1410);
      g.roundRect(-r * 0.25, r * 0.4, r * 0.5, 0.9, 0.5).fill({ color: 0x5a2a22, alpha: 0.8 });
    }
    // hair: from behind it covers the head, from the front only the top
    const cover = toward ? 0.55 : 1;
    const hair = s.hairColour;
    if (s.hair !== "none" && s.hair !== "cap") {
      g.arc(0, 0, r * 1.02, Math.PI, 0).fill(hair);
      if (!toward) g.circle(0, r * 0.05, r * 1.02).fill(hair);
      if (s.hair === "long") g.roundRect(-r * 1.02, -r * 0.1, r * 2.04, r * (toward ? 1.6 : 2.1), 3).fill(hair);
      if (s.hair === "curly") for (const [x, y] of [[-0.8, -0.5], [-0.35, -0.95], [0.35, -0.95], [0.8, -0.5], [0, -0.7]]) g.circle(x * r, y * r, r * 0.42).fill(hair);
      if (s.hair === "tied") g.circle(0, -r * 1.05, r * 0.38).fill(hair);
    }
    void cover;
    if (s.headwear === "helmet") {
      g.circle(0, -r * 0.1, r * 1.14).fill(s.helmetColour);
      g.arc(0, -r * 0.1, r * 1.14, Math.PI * 1.15, Math.PI * 1.85).stroke({ color: 0xffffff, width: 1.2, alpha: 0.35 }); // a highlight, so it reads as a helmet
      g.rect(-r * 0.16, -r * 1.24, r * 0.32, r * 1.0).fill(s.trim); // a stripe in the team's accent colour
      if (toward) g.roundRect(-r * 0.9, -r * 0.2, r * 1.8, r * 0.5, 2).fill(0x15191f);
      else g.rect(-r * 0.2, -r * 0.7, r * 0.4, r * 0.5).fill({ color: 0x000000, alpha: 0.15 });
    } else if (s.headwear === "headset") {
      g.arc(0, -r * 0.1, r * 1.08, Math.PI * 1.02, Math.PI * 1.98).stroke({ color: 0x15191f, width: 1.6 });
      g.circle(-r * 1.05, r * 0.1, r * 0.32).fill(0x15191f);
      g.circle(r * 1.05, r * 0.1, r * 0.32).fill(0x15191f);
      if (toward) g.moveTo(r * 1.05, r * 0.2).lineTo(r * 0.45, r * 0.75).stroke({ color: 0x15191f, width: 1 });
    }
    if (s.hair === "cap") g.arc(0, 0, r * 1.06, Math.PI, 0).fill(s.helmetColour).rect(-r * 1.06, -r * 0.08, r * 2.12, r * 0.22).fill(s.helmetColour);
    this.head.addChild(g);
  }

  apply(p: Pose) {
    const a = this.a;
    this.rig.y = -p.hop; // the root stays at the feet
    this.legs.scale.y = p.squash;
    this.legs.pivot.y = 0;
    this.torso.position.set(0, a.hipY * p.squash - p.bob);
    this.torso.rotation = p.lean;
    this.armL.rotation = p.armL;
    this.armR.rotation = -p.armR;
    this.head.rotation = p.headTilt;
    if (p.sign !== this.lastSign) {
      this.lastSign = p.sign;
      this.sign.clear();
      this.sign.circle(0, 0, 9).fill(SIGN[p.sign]).stroke({ color: 0x15191f, width: 1.2 });
      if (p.sign !== "off") this.sign.circle(0, 0, 15).fill({ color: SIGN[p.sign], alpha: 0.16 });
    }
  }
}
