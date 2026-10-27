import { describe, expect, it } from "vitest";
import { INTRO_MS, POSES, deskness, easeInOutCubic, lerpPose, matrixFor, planMove, poseAt, progressAt, withDrop } from "./camera";
import { DESK_TOP, DROP, HEADER_H, MONITORS, STAGE, screenOf, type Rect } from "./layout";

describe("camera", () => {
  it("is the identity at the pit-wall pose on a 1920x1080 window, so monitor text is at native pixels", () => {
    expect(matrixFor(POSES.pitwall, 1920, 1080)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("scales to fit other windows and keeps the focus point in the middle", () => {
    const m = matrixFor(POSES.pitwall, 2560, 1440);
    expect(m.scale).toBeCloseTo(4 / 3);
    for (const [vw, vh] of [[1920, 1080], [2560, 1440], [1366, 768], [1600, 1200]]) {
      for (const pose of Object.values(POSES)) {
        const k = matrixFor(pose, vw, vh);
        expect(pose.fx * k.scale + k.tx).toBeCloseTo(vw / 2);
        expect(pose.fy * k.scale + k.ty).toBeCloseTo(vh / 2);
      }
    }
    expect(matrixFor(POSES.pitwall, 1600, 1200).scale).toBeCloseTo(1600 / 1920); // a taller window is fit by width
  });

  it("eases from 0 to 1 and never goes backwards", () => {
    expect([easeInOutCubic(0), easeInOutCubic(1), easeInOutCubic(0.5)]).toEqual([0, 1, 0.5]);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const e = easeInOutCubic(Math.min(t, 1));
      expect(e).toBeGreaterThanOrEqual(last);
      last = e;
    }
  });

  it("tweens between the two poses and lands exactly on them", () => {
    const tw = { from: POSES.landing, to: POSES.pitwall, start: 1000, duration: INTRO_MS };
    expect(poseAt(tw, 0)).toEqual(POSES.landing);
    expect(poseAt(tw, 1000)).toEqual(POSES.landing);
    const end = poseAt(tw, 1000 + INTRO_MS);
    expect(end.zoom).toBeCloseTo(1, 10);
    expect([end.fx, end.fy]).toEqual([960, 540]);
    expect(poseAt(tw, 99999)).toEqual(end);
    const mid = lerpPose(POSES.landing, POSES.pitwall, 0.5);
    expect(mid.zoom).toBeCloseTo(Math.sqrt(POSES.landing.zoom), 6); // log-space midpoint
    expect(progressAt({ ...tw, duration: 0 }, 5)).toBe(1);
  });

  it("zoom and focus move monotonically during the tween", () => {
    const tw = { from: POSES.landing, to: POSES.pitwall, start: 0, duration: 1000 };
    let last = poseAt(tw, 0);
    for (let t = 16; t <= 1000; t += 16) {
      const p = poseAt(tw, t);
      expect(p.zoom).toBeLessThanOrEqual(last.zoom + 1e-12);
      expect(p.fy).toBeGreaterThanOrEqual(last.fy - 1e-12);
      last = p;
    }
  });
});

describe("planMove", () => {
  const base = { reducedMotion: false, skipIntro: false, seenRoom: false, session: "GRID" };
  it("plays the move only when the grid is first shown", () => {
    expect(planMove(base)).toEqual({ animate: true, ms: INTRO_MS });
  });
  it("goes straight to the end pose for reduced motion, a skipped intro, a seen room", () => {
    for (const o of [{ reducedMotion: true }, { skipIntro: true }, { seenRoom: true }]) expect(planMove({ ...base, ...o })).toEqual({ animate: false, ms: 0 });
  });
  it("never replays the move for a snapshot taken mid-race, after a reconnect or a reload", () => {
    for (const session of ["RACING", "SC", "VSC", "RED", "FINISHED"]) expect(planMove({ ...base, session }).animate).toBe(false);
  });
});

describe("layout", () => {
  const all = Object.entries(MONITORS).filter(([n]) => n !== "strategy") as [string, Rect][]; // the strategy screen is to the right of the stage on purpose
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("keeps every monitor on the stage, below the header and on the desk", () => {
    for (const [name, r] of all) {
      expect(r.x, name).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, name).toBeLessThanOrEqual(STAGE.w);
      expect(r.y, name).toBeGreaterThanOrEqual(DESK_TOP);
      expect(r.y + r.h, name).toBeLessThanOrEqual(STAGE.h);
      expect(r.y, name).toBeGreaterThan(HEADER_H);
    }
  });

  it("does not overlap monitors that are shown together", () => {
    const three = [MONITORS.tower, MONITORS.map, MONITORS.ops];
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(three[i], three[j])).toBe(false);
  });

  it("gives the tower room for 22 rows of 25 px plus a header, so the whole grid is readable at once", () => {
    const s = screenOf(MONITORS.tower);
    expect(s.h).toBeGreaterThanOrEqual(22 * 25 + 36);
    expect(s.w).toBeGreaterThanOrEqual(560);
  });
});

describe("the strategy screen", () => {
  it("is to the right of the wall at the same height, and the camera pose centres it", () => {
    const s = MONITORS.strategy, o = MONITORS.ops;
    expect(s.x).toBeGreaterThan(STAGE.w);
    expect([s.y, s.h]).toEqual([o.y, o.h]);
    expect(POSES.strategy.fx).toBe(s.x + s.w / 2);
  });
  it("keeps the monitors fully shown while looking between the wall and the screen, and fades them only from the landing shot", () => {
    for (const p of [0, 0.5, 1]) {
      expect(deskness("pitwall", "strategy", p)).toBe(1);
      expect(deskness("strategy", "pitwall", p)).toBe(1);
    }
    expect(deskness("landing", "pitwall", 0.25)).toBe(0.25);
    expect(deskness("pitwall", "landing", 0.25)).toBe(0.75);
  });
});

describe("the drop", () => {
  it("moves the focus down by the drop and no further, and the monitors grow by the same amount", () => {
    expect(withDrop(POSES.pitwall, 0)).toEqual(POSES.pitwall);
    expect(withDrop(POSES.pitwall, 1).fy).toBe(POSES.pitwall.fy + DROP);
    expect(withDrop(POSES.strategy, 0.5).fx).toBe(POSES.strategy.fx);
    const m = MONITORS.tower;
    expect(m.y + m.h + DROP).toBeLessThanOrEqual(POSES.pitwall.fy + DROP + STAGE.h / 2); // still inside the dropped view
  });
});
