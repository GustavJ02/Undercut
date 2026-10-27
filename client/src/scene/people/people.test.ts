import { describe, expect, it } from "vitest";
import type { Cue } from "../../render/model";
import { Director, ROSTER } from "./director";
import { CLIP_SECONDS, REST, finished, poseAt, type ClipName } from "./poses";
import { BASE_HEIGHT, anchors, characterSpec, hexNum } from "./spec";
import type { Archetype } from "../../packs/types";

const A: Archetype = { role: "crew", build: "medium", height: 1, hair: "short", skin: "#c58c63" };
const kit = { kit: "#336699", helmet: "#eeeeee", trim: "#ffcc00", facing: "away" as const, seed: "x" };
const cue = (type: Cue["type"], car?: string, tick = 1): Cue => ({ id: `${tick}:${type}:${car}`, type, tick, car });
const CLIPS = Object.keys(CLIP_SECONDS) as ClipName[];

describe("character spec", () => {
  it("takes colours from the pack and proportions from the archetype", () => {
    const s = characterSpec(A, kit);
    expect(s.kit).toBe(hexNum("#336699"));
    expect(s.helmetColour).toBe(hexNum("#eeeeee"));
    expect(s.skin).toBe(hexNum("#c58c63"));
    expect(s.height).toBe(BASE_HEIGHT);
    expect(characterSpec({ ...A, build: "broad" }, kit).torsoW).toBeGreaterThan(characterSpec({ ...A, build: "lean" }, kit).torsoW);
    expect(characterSpec({ ...A, height: 1.1 }, kit).height).toBeCloseTo(BASE_HEIGHT * 1.1);
  });
  it("gives roles their headwear, and drivers a suit in the kit colour", () => {
    expect(characterSpec(A, kit).headwear).toBe("helmet");
    expect(characterSpec({ ...A, role: "engineer" }, kit).headwear).toBe("headset");
    const d = characterSpec({ ...A, role: "driver" }, kit);
    expect([d.headwear, d.prop, d.trousers]).toEqual(["none", "helmet", d.kit]);
  });
  it("is deterministic, and varies hair tone with the seed", () => {
    expect(characterSpec(A, kit)).toEqual(characterSpec(A, kit));
    const tones = new Set(Array.from({ length: 12 }, (_, i) => characterSpec(A, { ...kit, seed: `p${i}` }).hairColour));
    expect(tones.size).toBeGreaterThan(2);
  });
  it("puts the anchors inside the body", () => {
    const s = characterSpec(A, kit);
    const a = anchors(s);
    expect(a.hipY).toBeLessThan(0);
    expect(a.torsoTop).toBeLessThan(a.hipY);
    expect(a.headY).toBeLessThan(a.torsoTop);
    expect(-a.headY + s.headR).toBeLessThan(s.height * 1.05);
  });
});

describe("poses", () => {
  it("every clip gives finite, bounded values at every moment", () => {
    for (const c of CLIPS)
      for (let t = 0; t < 12; t += 0.037) {
        const p = poseAt(c, t, 0.7);
        for (const v of [p.armL, p.armR, p.bob, p.squash, p.lean, p.headTilt, p.hop]) expect(Number.isFinite(v), `${c} ${t}`).toBe(true);
        expect(Math.abs(p.armL)).toBeLessThanOrEqual(3.3);
        expect(Math.abs(p.armR)).toBeLessThanOrEqual(3.3);
        expect(p.squash).toBeGreaterThan(0.7);
        expect(p.squash).toBeLessThanOrEqual(1);
        expect(p.hop).toBeGreaterThanOrEqual(0);
        expect(p.hop).toBeLessThan(12);
      }
  });
  it("starts every clip from idle without a jump (blended in), so a change of clip never snaps", () => {
    const idle = poseAt("idle", 0, 0.3);
    for (const c of CLIPS) {
      const p = poseAt(c, 0, 0.3);
      expect(Math.abs(p.armL - idle.armL), c).toBeLessThan(0.01);
      expect(Math.abs(p.armR - idle.armR), c).toBeLessThan(0.01);
      expect(Math.abs(p.squash - idle.squash), c).toBeLessThan(0.01);
    }
  });
  it("idle stays near rest and is out of step between people", () => {
    for (let t = 0; t < 20; t += 0.1) expect(Math.abs(poseAt("idle", t).armL - REST.armL)).toBeLessThan(0.06);
    expect(poseAt("idle", 1, 0).bob).not.toBeCloseTo(poseAt("idle", 1, 1.3).bob, 3);
  });
  it("the gun shakes fast, the jack goes up and comes back, the cheer leaves the ground", () => {
    const gun = Array.from({ length: 60 }, (_, i) => poseAt("gun", 0.5 + i / 60).armR);
    expect(Math.max(...gun) - Math.min(...gun)).toBeGreaterThan(0.25);
    expect(poseAt("jack", 1.1).armL).toBeGreaterThan(poseAt("jack", 0).armL + 0.8);
    expect(poseAt("jack", 2.2).armL).toBeLessThan(poseAt("jack", 1.1).armL - 0.8);
    expect(Math.max(...Array.from({ length: 80 }, (_, i) => poseAt("cheer", 1 + i / 40).hop))).toBeGreaterThan(5);
  });
  it("timed clips finish and holding clips do not", () => {
    expect(finished("gun", 1.7)).toBe(false);
    expect(finished("gun", 1.9)).toBe(true);
    expect(finished("ready", 999)).toBe(false);
  });
  it("shows the lollipop board red then green", () => {
    expect(poseAt("lollipopRed", 1).sign).toBe("red");
    expect(poseAt("lollipopGreen", 1).sign).toBe("green");
    expect(poseAt("idle", 1).sign).toBe("off");
  });
});

describe("director", () => {
  const D = () => new Director(["BRA", "ALD"]);
  const clip = (d: Director, id: string, now: number) => d.clip(id, now).clip;

  it("starts everyone at their normal activity, with drivers off show", () => {
    const d = D();
    expect(clip(d, "crew-wheel-fl", 0)).toBe("idle");
    expect(clip(d, "eng-1", 0)).toBe("tablet");
    expect(d.visible("driver-0")).toBe(false);
    expect(d.visible("crew-lollipop")).toBe(true);
  });

  it("runs a pit stop: ready on the call, the board red when the car is in the lane, jacks then guns when it stops, green board, back to idle on pit out", () => {
    const d = D();
    d.onCue(cue("pitCall", "BRA"), 1000);
    expect(clip(d, "crew-wheel-fl", 1100)).toBe("ready");
    expect(clip(d, "crew-lollipop", 1100)).toBe("lollipopRed");
    d.onCue(cue("pitIn", "BRA"), 5000);
    d.update(9000);
    expect(clip(d, "crew-wheel-fl", 9000)).toBe("ready"); // the car has not stopped yet: nobody works
    d.onStop(10000);
    d.update(10100);
    expect(clip(d, "crew-wheel-fl", 10100)).toBe("ready");
    d.update(10250);
    expect(clip(d, "crew-jack-f", 10250)).toBe("jack");
    d.update(10500);
    expect(clip(d, "crew-wheel-rr", 10500)).toBe("gun");
    d.update(12500);
    expect(clip(d, "crew-lollipop", 12500)).toBe("lollipopGreen");
    d.update(14600);
    expect(clip(d, "crew-wheel-fl", 14600)).toBe("idle");
    expect(clip(d, "crew-lollipop", 14600)).toBe("idle");
  });

  it("a pit out ends the stop at once and cancels clips not yet started", () => {
    const d = D();
    d.onCue(cue("pitIn", "ALD"), 1000);
    d.onStop(1100);
    d.onCue(cue("pitOut", "ALD"), 1200);
    d.update(3000);
    expect(clip(d, "crew-wheel-fl", 3000)).toBe("idle");
  });

  it("ignores rivals' pit calls and stops", () => {
    const d = D();
    d.onCue(cue("pitCall", "GAN"), 1000);
    d.onCue(cue("pitIn", "GAN"), 2000);
    d.update(3000);
    expect(clip(d, "crew-wheel-fl", 3000)).toBe("idle");
  });

  it("a held ready call lapses after 25 s if the car never comes in", () => {
    const d = D();
    d.onCue(cue("pitCall", "BRA"), 0);
    d.update(24000);
    expect(clip(d, "crew-jack-r", 24000)).toBe("ready");
    d.update(26000);
    expect(clip(d, "crew-jack-r", 26000)).toBe("idle");
  });

  it("safety car: engineers on the radio and pointing, strategist on the radio; red flag folds the crew's arms until green", () => {
    const d = D();
    d.onCue(cue("scDeployed"), 1000);
    expect([clip(d, "eng-1", 1000), clip(d, "eng-2", 1000), clip(d, "strategist", 1000)]).toEqual(["radio", "point", "radio"]);
    d.update(9000);
    expect([clip(d, "eng-1", 9000), clip(d, "eng-2", 9000)]).toEqual(["tablet", "idle"]);
    d.onCue(cue("redFlag"), 10000);
    expect(clip(d, "crew-wheel-fl", 10100)).toBe("crossed");
    d.onCue(cue("greenFlag"), 20000);
    expect(clip(d, "crew-wheel-fl", 20000)).toBe("idle");
  });

  it("a retirement brings the right driver out; the other stays away", () => {
    const d = D();
    d.onCue(cue("retire", "BRA"), 1000);   // the second of the two cars in sorted order
    expect([d.visible("driver-0"), d.visible("driver-1")]).toEqual([false, true]);
    expect(clip(d, "driver-1", 1500)).toBe("gloom");
    d.onCue(cue("retire", "GAN"), 2000);
    expect(d.visible("driver-0")).toBe(false);
  });

  it("a win for the player's car makes everyone cheer, then settle; a rival's win changes nothing", () => {
    const d = D();
    d.onCue(cue("win", "GAN"), 1000);
    expect(clip(d, "crew-lollipop", 1100)).toBe("idle");
    d.onCue(cue("win", "BRA"), 2000);
    expect([clip(d, "crew-lollipop", 2100), clip(d, "eng-2", 2100), clip(d, "strategist", 2100)]).toEqual(["cheer", "cheer", "cheer"]);
    expect([d.visible("driver-0"), d.visible("driver-1")]).toEqual([true, true]);
    d.update(13000);
    expect(clip(d, "crew-lollipop", 13000)).toBe("idle");
  });

  it("has a unique id and a place on the stage for everyone", () => {
    expect(new Set(ROSTER.map((s) => s.id)).size).toBe(ROSTER.length);
    for (const s of ROSTER) expect(s.x > 100 && s.x < 1800 && s.y > 380 && s.y < 420).toBe(true);
  });
});
