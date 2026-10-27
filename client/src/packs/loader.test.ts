import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPacks } from "./loader";
import { packDirs, packRoots } from "./readDir";
import { BASE, minimal, png } from "./testkit";

let tmp: string;
const write = (rel: string, data: string | Uint8Array) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true });
  writeFileSync(join(tmp, rel), data);
};
const modOf = (name: string, m: object) => write(`${name}/manifest.json`, JSON.stringify(m));

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "undercut-packs-"));
  modOf("good", minimal({ id: "good-mod", teams: {} }));
  modOf("broken", { ...minimal(), id: "broken-mod", colour: "x" });
  modOf("claims-base", minimal({ id: "claims-base", kind: "base" }));
  modOf("dup", minimal({ id: "good-mod" }));
  modOf("linked", minimal({ id: "linked-mod" }));
  write("outside.png", png());
  symlinkSync(join(tmp, "outside.png"), join(tmp, "linked", "assets-link.png"));
  write("script/manifest.json", JSON.stringify(minimal({ id: "script-mod" })));
  write("script/payload.js", "alert(1)");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadPacks", () => {
  it("loads the base pack and good mods in order", () => {
    const r = loadPacks(BASE, [join(tmp, "good")]);
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["base-fictional", "good-mod"]);
    expect(r.rejected).toEqual([]);
  });

  it("skips bad mods with readable reasons and keeps going", () => {
    const dirs = ["broken", "claims-base", "good", "dup", "linked", "script"].map((d) => join(tmp, d));
    const r = loadPacks(BASE, dirs);
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["base-fictional", "good-mod"]);
    const report = r.rejected.map((x) => x.report).join("\n");
    expect(report).toContain("broken:manifest.json: must NOT have additional properties");
    expect(report).toContain("claims-base:manifest.json.kind");
    expect(report).toContain("good-mod:manifest.json.id: another pack already uses this id");
    expect(report).toContain("linked:assets-link.png: symbolic links are not allowed");
    expect(report).toContain("script:payload.js: file type '.js' is not allowed");
    expect(r.rejected).toHaveLength(5);
  });

  it("does not throw for a missing mod folder", () => {
    const r = loadPacks(BASE, [join(tmp, "nope")]);
    expect(r.packs).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });

  it("refuses a broken base pack", () => {
    expect(() => loadPacks(join(tmp, "broken"), [])).toThrow(/base pack is broken/);
    expect(() => loadPacks(join(tmp, "good"), [])).toThrow(/kind 'base'/);
  });
});

describe("discovery", () => {
  it("lists repo examples, mods/local and the user data folder, later overriding earlier", () => {
    const roots = packRoots("/repo", { XDG_DATA_HOME: "/data" }, "linux");
    expect(roots).toEqual(["/repo/mods/examples", "/repo/mods/local", "/data/undercut/mods"]);
    expect(packRoots("/repo", { APPDATA: "C:\\A" }, "win32")[2]).toContain("undercut");
    expect(packDirs(join(tmp, "missing"))).toEqual([]);
    expect(packDirs(tmp).map((d) => d.split("/").pop())).toContain("good");
  });
});
