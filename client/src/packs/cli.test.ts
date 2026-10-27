import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { minimal, png } from "./testkit";

const CLIENT = resolve(__dirname, "../..");
const run = (...args: string[]) => spawnSync(join(CLIENT, "node_modules/.bin/vite-node"), ["scripts/mods.ts", ...args], { cwd: CLIENT, encoding: "utf8" });

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "undercut-cli-"));
  mkdirSync(join(tmp, "broken/assets"), { recursive: true });
  writeFileSync(join(tmp, "broken/manifest.json"), JSON.stringify({ ...minimal({ id: "broken-mod", sounds: { gun: "assets/gun.wav" } }), version: "one", extra: 1 }));
  writeFileSync(join(tmp, "broken/assets/payload.js"), "alert(1)");
  writeFileSync(join(tmp, "broken/assets/car.png"), png());
  symlinkSync(join(tmp, "broken/assets/car.png"), join(tmp, "broken/assets/link.png"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the mods command line", () => {
  it("accepts the example mod and exits 0", () => {
    const r = run("validate", "../mods/examples/neon-harbour");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("OK   neon-harbour@1.0.0");
    expect(r.stdout).toContain("1 of 1 packs are valid.");
  });

  it("finds the packs in a folder of packs", () => {
    const r = run("validate", "../mods/examples");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("neon-harbour");
  });

  it("reports every problem of a broken pack in a readable form and exits 1", () => {
    const r = run("validate", join(tmp, "broken"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL");
    expect(r.stdout).toContain("broken:assets/payload.js: file type '.js' is not allowed");
    expect(r.stdout).toContain("broken:assets/link.png: symbolic links are not allowed");
    expect(r.stdout).toContain("manifest.json.version: has the wrong format: expected a version like 1.0.0");
    expect(r.stdout).toContain("0 of 1 packs are valid.");
  });

  it("explains its usage when called wrongly", () => {
    expect(run("validate").status).toBe(2);
    expect(run("init").status).toBe(2);
    expect(run("init", "Bad Id").stderr).toContain("lowercase");
    expect(run("nonsense").status).toBe(2);
  });

  it("starts a pack from the base pack's ids that passes validation, and will not overwrite it", () => {
    const env = { ...process.env, UNDERCUT_MODS_LOCAL: join(tmp, "local") };
    const init = spawnSync(join(CLIENT, "node_modules/.bin/vite-node"), ["scripts/mods.ts", "init", "my-pack", "--name", "My pack"], { cwd: CLIENT, encoding: "utf8", env });
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("never committed");
    const check = run("validate", join(tmp, "local/my-pack"));
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("OK   my-pack@0.1.0");
    const again = spawnSync(join(CLIENT, "node_modules/.bin/vite-node"), ["scripts/mods.ts", "init", "my-pack"], { cwd: CLIENT, encoding: "utf8", env });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already exists");
  });
});
