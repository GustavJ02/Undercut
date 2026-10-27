import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPacks } from "./loader";
import { createResolver } from "./resolve";
import { BASE } from "./testkit";
import { allSynth } from "../render/synth";
import { toRenderModel } from "../render/model";
import { baseCars, basePack, fixture, play, urlFor } from "../render/testkit";
import { ModelStore } from "../render/store";
import { findLeaks } from "../render/leaks";

const REPO = resolve(__dirname, "../../..");
const EXAMPLES = join(REPO, "mods", "examples");
const bundle = JSON.parse(readFileSync(join(REPO, "params/bundles", readdirSync(join(REPO, "params/bundles")).filter((f) => f.endsWith(".json")).sort().pop()!), "utf8"));
const loaded = loadPacks(BASE, [join(EXAMPLES, "neon-harbour")]);
const mod = loaded.packs[1];

describe("the example mod", () => {
  it("validates, with no errors, and is a mod", () => {
    expect(loaded.rejected).toEqual([]);
    expect(mod.manifest.id).toBe("neon-harbour");
    expect(mod.manifest.kind).toBe("mod");
    expect(mod.files.sort()).toEqual(["assets/gun.wav", "assets/harbour-livery.png", "assets/radio-open.wav"]);
  });

  it("covers every team and driver of the bundle", () => {
    for (const t of bundle.teams) {
      expect(mod.manifest.teams?.[t.id], t.id).toBeDefined();
      for (const d of t.drivers) expect(mod.manifest.drivers?.[d.id], d.id).toBeDefined();
    }
  });

  it("shares no name or palette with the base pack, and no name with the bundle's real ones", () => {
    const names = (m: typeof mod.manifest) => [...Object.values(m.teams!).map((t) => t.displayName), ...Object.values(m.drivers!).map((d) => d.displayName)];
    const baseNames = new Set(names(basePack.manifest));
    for (const n of names(mod.manifest)) expect(baseNames.has(n), n).toBe(false);
    const real = bundle.teams.flatMap((t: { name: string; drivers: { name: string }[] }) => [t.name, ...t.drivers.map((d) => d.name)]).map((n: string) => n.toLowerCase());
    const text = JSON.stringify(mod.manifest).toLowerCase();
    for (const n of real) expect(text, n).not.toContain(n);
    const basePrimaries = new Set(Object.values(basePack.manifest.teams!).map((t) => t.colours.primary.toLowerCase()));
    for (const t of Object.values(mod.manifest.teams!)) expect(basePrimaries.has(t.colours.primary.toLowerCase())).toBe(false);
  });

  it("is dressed differently: other archetypes, other numbers for most drivers", () => {
    const baseIds = new Set(Object.keys(basePack.manifest.archetypes!));
    for (const id of Object.keys(mod.manifest.archetypes!)) expect(baseIds.has(id)).toBe(false);
    const same = Object.entries(mod.manifest.drivers!).filter(([id, d]) => basePack.manifest.drivers![id].number === d.number).length;
    expect(same).toBeLessThan(4);
  });

  it("has the example's own README outside the pack folder, since a pack may hold only assets and a manifest", () => {
    expect(readdirSync(EXAMPLES).sort()).toEqual(["README.md", "neon-harbour"]);
    expect(readdirSync(join(EXAMPLES, "neon-harbour")).sort()).toEqual(["assets", "manifest.json"]);
  });
});

describe("an alternate pack changes everything the scene shows, and nothing from the base pack is hard-coded", () => {
  const baseResolver = createResolver([basePack], urlFor);
  const modResolver = createResolver(loaded.packs, urlFor, "neon-harbour");

  it("resolves every id to the mod's identity when it is active, and to the base's when it is not", () => {
    for (const t of bundle.teams) {
      expect(modResolver.team(t.id).displayName).toBe(mod.manifest.teams![t.id].displayName);
      expect(createResolver(loaded.packs, urlFor).team(t.id).displayName).toBe(mod.manifest.teams![t.id].displayName); // the latest pack wins by default
      expect(baseResolver.team(t.id).displayName).toBe(basePack.manifest.teams![t.id].displayName);
    }
  });

  it("gives render models with the mod's colours and numbers, and none of the base pack's", () => {
    const msgs = fixture("race-austin-8.json");
    const a = new ModelStore(baseResolver), b = new ModelStore(modResolver);
    play(msgs, a);
    play(msgs, b);
    const ma = a.model!, mb = b.model!;
    expect(mb.cars.map((c) => c.id)).toEqual(ma.cars.map((c) => c.id));
    for (let i = 0; i < ma.cars.length; i++) {
      expect(mb.cars[i].livery.primary).toBe(mod.manifest.teams![mb.cars[i].teamId].colours.primary);
      expect(mb.cars[i].num).toBe(mod.manifest.drivers![mb.cars[i].id].number);
      expect(mb.cars[i].livery.primary).not.toBe(ma.cars[i].livery.primary);
    }
    const json = JSON.stringify(mb);
    for (const t of Object.values(basePack.manifest.teams!)) expect(json.toLowerCase()).not.toContain(t.colours.primary.toLowerCase());
    expect(findLeaks(mb, new Set())).toEqual([]);
  });

  it("works with a pack of generated identities for ids no pack knows, and invents no real names", () => {
    const empty = createResolver([], urlFor);
    const model = toRenderModel(null, { ...fromSynth(), events: [] }, empty);
    for (const c of model.cars) {
      expect(c.livery.primary).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.num).toBeGreaterThanOrEqual(1);
    }
    const real = bundle.teams.flatMap((t: { name: string; drivers: { name: string }[] }) => [t.name, ...t.drivers.map((d) => d.name)]);
    for (const n of real) expect(JSON.stringify(model).toLowerCase()).not.toContain(String(n).toLowerCase());
  });

  it("uses the mod's livery image through the owning pack, and the mod's sounds", () => {
    expect(modResolver.teamImageUrl("VMR")).toBe("/neon-harbour/assets/harbour-livery.png");
    expect(modResolver.teamImageUrl("OHB")).toBeUndefined();
    expect(baseResolver.teamImageUrl("VMR")).toBeUndefined();
    expect(modResolver.sound("gun")).toBe("/neon-harbour/assets/gun.wav");
    expect(modResolver.sound("passBy")).toBeUndefined();
  });
});

function fromSynth() {
  const msgs = allSynth({ seed: 2, carIds: baseCars(), laps: 2, lapS: 30 });
  const snap = msgs[0] as Extract<(typeof msgs)[number], { type: "snapshot" }>;
  return { view: snap.view, clock: { tick: 0, speed: 1, paused: false }, info: snap.info };
}
