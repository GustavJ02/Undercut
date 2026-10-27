import { describe, expect, it } from "vitest";
import { Registry, type PackEntry } from "./registry";
import { basePack } from "../render/testkit";
import type { LoadedPack } from "./types";

const mod = (id: string, name: string): LoadedPack => ({
  manifest: { schema: 1, id, name: id, version: "1.0.0", author: "t", licence: "x", kind: "mod", teams: { VMR: { ...basePack.manifest.teams!.VMR, displayName: name } } },
  files: [],
  root: `/mods/examples/${id}`,
});
const entry = (id: string, over: Partial<PackEntry> = {}): PackEntry => ({ source: "examples", folder: id, root: `/mods/examples/${id}`, ok: true, id, errors: [], ...over });

function make(entries: PackEntry[] | null, loadable: Record<string, LoadedPack>) {
  return new Registry(
    async () => (entries ? { packs: entries.map((e) => ({ ...e, errors: [...e.errors] })) } : null),
    async (root) => {
      if (root === "/packs/base-fictional") return basePack;
      const p = loadable[root.split("/").pop()!];
      if (!p) throw new Error("404");
      return p;
    },
  );
}

describe("Registry", () => {
  it("is the base pack alone until a mod is chosen, even when mods exist", async () => {
    const r = make([entry("alpha")], { alpha: mod("alpha", "Alpha") });
    await r.ensure();
    expect(r.entries.map((e) => e.id)).toEqual(["alpha"]);
    expect(r.resolver().team("VMR").displayName).toBe(basePack.manifest.teams!.VMR.displayName);
  });

  it("uses the chosen mod over the base, and goes back when it is unchosen", async () => {
    const r = make([entry("alpha"), entry("beta")], { alpha: mod("alpha", "Alpha"), beta: mod("beta", "Beta") });
    await r.ensure();
    r.setActive("beta");
    expect(r.resolver().team("VMR").displayName).toBe("Beta");
    expect(r.resolver().team("OHB").displayName).toBe(basePack.manifest.teams!.OHB.displayName); // not in the mod: the base
    r.setActive(null);
    expect(r.resolver().team("VMR").displayName).toBe(basePack.manifest.teams!.VMR.displayName);
  });

  it("tells listeners when the choice or the packs change, and stops when unsubscribed", async () => {
    const r = make([entry("alpha")], { alpha: mod("alpha", "Alpha") });
    await r.ensure();
    let n = 0;
    const off = r.subscribe(() => n++);
    r.setActive("alpha");
    r.setActive("alpha"); // no change
    await r.reload();
    expect(n).toBe(2);
    off();
    r.setActive(null);
    expect(n).toBe(2);
  });

  it("lists a pack the server calls broken with its errors, and does not try to load it", async () => {
    const r = make([entry("bad", { ok: false, errors: ["bad:manifest.json: unknown key 'x'"] })], {});
    await r.ensure();
    expect(r.entries[0]).toMatchObject({ ok: false, errors: ["bad:manifest.json: unknown key 'x'"] });
    r.setActive("bad");
    expect(r.activeId).toBeNull();
  });

  it("marks a mod that the page cannot load as failed and keeps the others", async () => {
    const r = make([entry("gone"), entry("alpha")], { alpha: mod("alpha", "Alpha") });
    await r.ensure();
    expect(r.entries.find((e) => e.id === "gone")).toMatchObject({ ok: false });
    expect(r.entries.find((e) => e.id === "gone")!.errors.join()).toContain("could not be loaded");
    r.setActive("alpha");
    expect(r.activeId).toBe("alpha");
  });

  it("falls back to the base pack when the active mod disappears on reload", async () => {
    const entries = [entry("alpha")];
    let list: PackEntry[] = entries;
    const r = new Registry(async () => ({ packs: list.map((e) => ({ ...e })) }), async (root) => (root.endsWith("base-fictional") ? basePack : mod("alpha", "Alpha")));
    await r.ensure();
    r.setActive("alpha");
    list = [];
    await r.reload();
    expect(r.activeId).toBeNull();
    expect(r.resolver().team("VMR").displayName).toBe(basePack.manifest.teams!.VMR.displayName);
  });

  it("works with a server that does not list mods, and says so", async () => {
    const r = make(null, {});
    await r.ensure();
    expect(r.entries).toEqual([]);
    expect(r.listError).toContain("does not list mods");
    expect(r.resolver().team("VMR").displayName).toBe(basePack.manifest.teams!.VMR.displayName);
  });
});
