import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFiles } from "./loader";
import { readPackDir } from "./readDir";
import { BASE } from "./testkit";
import { createResolver, generatedDriver, generatedTeam } from "./resolve";
import type { LoadedPack } from "./types";

const REPO = resolve(__dirname, "../../..");
const bundles = readdirSync(join(REPO, "params/bundles")).filter((f) => f.endsWith(".json"));
const bundle = JSON.parse(readFileSync(join(REPO, "params/bundles", bundles.sort().pop()!), "utf8"));
const base = loadFiles(BASE, readPackDir(BASE)).pack as LoadedPack;
const url = (p: LoadedPack, path: string) => `/${p.manifest.id}/${path}`;
const r = createResolver([base], url);

const dist = (a: string, b: string) => {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.hypot(...c(a).map((x, i) => x - c(b)[i]));
};

describe("base pack", () => {
  it("covers every team and driver id in every bundle", () => {
    for (const f of bundles) {
      const b = JSON.parse(readFileSync(join(REPO, "params/bundles", f), "utf8"));
      for (const t of b.teams) {
        expect(base.manifest.teams?.[t.id], `${f} team ${t.id}`).toBeDefined();
        for (const d of t.drivers) expect(base.manifest.drivers?.[d.id], `${f} driver ${d.id}`).toBeDefined();
      }
    }
  });

  it("gives every team a distinct primary colour and every driver a distinct number", () => {
    const teams = Object.entries(base.manifest.teams!);
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        expect(dist(teams[i][1].colours.primary, teams[j][1].colours.primary), `${teams[i][0]} vs ${teams[j][0]}`).toBeGreaterThan(40);
    const numbers = Object.values(base.manifest.drivers!).map((d) => d.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(new Set(teams.map(([, t]) => t.short)).size).toBe(teams.length);
  });

  it("gives every team and driver of the bundle a name, a short code and a number of its own", () => {
    const m = base.manifest;
    const teams = bundle.teams as { id: string; drivers: { id: string }[] }[];
    for (const t of teams) {
      expect(m.teams![t.id].displayName).toBeTruthy();
      for (const d of t.drivers) expect(m.drivers![d.id].short, d.id).toMatch(/^[A-Z]{3}$/);
    }
    const drivers = Object.values(m.drivers!);
    expect(new Set(drivers.map((d) => d.number)).size).toBe(drivers.length);
    expect(new Set(drivers.map((d) => d.short)).size).toBe(drivers.length);
  });

  it("references archetypes that exist", () => {
    const known = new Set(Object.keys(base.manifest.archetypes!));
    for (const d of Object.values(base.manifest.drivers!)) expect(known.has(d.archetype)).toBe(true);
    for (const t of Object.values(base.manifest.teams!)) for (const e of t.engineers ?? []) expect(known.has(e)).toBe(true);
  });
});

describe("resolver", () => {
  it("resolves ids through the pack", () => {
    expect(r.team("VMR").displayName).toBe(base.manifest.teams!.VMR.displayName);
    expect(r.driver("ALD").number).toBe(base.manifest.drivers!.ALD.number);
  });

  it("generates valid identities for any id: a known pattern, real hex colours, a number from 1 to 99", () => {
    const patterns = ["solid", "stripe", "chevron", "split", "hoops", "diagonal", "dots"];
    const hex = /^#[0-9a-f]{6}$/;
    for (let i = 0; i < 4000; i++) {
      const id = `Q${(i * 2654435761).toString(36).toUpperCase()}`.slice(0, 8);
      const t = generatedTeam(id), d = generatedDriver(id);
      expect(patterns, `team ${id}`).toContain(t.livery.pattern);
      expect(patterns, `driver ${id}`).toContain(d.helmet.pattern);
      for (const c of [t.colours.primary, t.colours.secondary, t.colours.accent, t.crew.kit, t.crew.helmet, d.helmet.primary, d.helmet.secondary]) expect(c, id).toMatch(hex);
      expect(d.number >= 1 && d.number <= 99).toBe(true);
    }
  });

  it("falls back to deterministic generated identities that carry no real names", () => {
    const a = r.team("ZZZ");
    expect(a).toEqual(r.team("ZZZ"));
    expect(a).toEqual(generatedTeam("ZZZ"));
    expect(a.displayName).toBe("Team ZZZ");
    expect(r.team("YYY").colours.primary).not.toBe(a.colours.primary);
    expect(r.driver("QQQ")).toEqual(generatedDriver("QQQ"));
    expect(r.driver("QQQ").number).toBeGreaterThanOrEqual(1);
    expect(r.sound("gun")).toBeUndefined();
  });

  it("lists archetypes by role, mods first, base last, none twice", () => {
    expect(r.archetypeIds("crew")).toEqual(expect.arrayContaining(["crew-lean", "crew-broad", "crew-medium"]));
    expect(r.archetypeIds("strategist")).toEqual(["strategist-calm"]);
    const mod: LoadedPack = { manifest: { schema: 1 as const, id: "mod-x", name: "x", version: "1.0.0", author: "t", licence: "x", kind: "mod", archetypes: { "crew-lean": { role: "crew", build: "broad", height: 1, hair: "none", skin: "#ffffff" }, "crew-new": { role: "crew", build: "lean", height: 1, hair: "none", skin: "#ffffff" } } }, files: [], root: "x" };
    const ids = createResolver([base, mod], url).archetypeIds("crew");
    expect(ids.slice(0, 2).sort()).toEqual(["crew-lean", "crew-new"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets a mod override per id, with the active mod winning, and falls back to base for the rest", () => {
    const mod = (id: string, name: string): LoadedPack => ({
      manifest: { schema: 1, id, name: id, version: "1.0.0", author: "t", licence: "x", kind: "mod", teams: { VMR: { ...base.manifest.teams!.VMR, displayName: name } }, sounds: { gun: "assets/g.wav" } },
      files: ["assets/g.wav"],
      root: id,
    });
    const a = mod("mod-a", "Alpha"), b = mod("mod-b", "Beta");
    expect(createResolver([base, a, b], url).team("VMR").displayName).toBe("Beta");
    expect(createResolver([base, a, b], url, "mod-a").team("VMR").displayName).toBe("Alpha");
    expect(createResolver([base, a], url).team("OHB")).toEqual(base.manifest.teams!.OHB);
    expect(createResolver([base, a], url).sound("gun")).toBe("/mod-a/assets/g.wav");
  });
});
