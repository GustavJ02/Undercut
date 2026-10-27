import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module shared with the hook script
import { blockedPaths } from "../../scripts/localGuard.mjs";

const REPO = resolve(__dirname, "../../..");
const SCRIPTS = resolve(__dirname, "../../scripts");

describe("mods/local guard", () => {
  it("blocks private mod paths and nothing else", () => {
    const bad = ["mods/local/x/manifest.json", "mods/local", "./mods/local/a.png", "mods\\local\\a.png", "mods/pack.zip", "client/public/mods-user/a/manifest.json"];
    expect(blockedPaths(bad)).toHaveLength(bad.length);
    const fine = ["mods/examples/neon/manifest.json", "mods/localish/a.png", "docs/modding.md", "client/src/mods/local.ts", "mods/examples/a.zip.txt"];
    expect(blockedPaths(fine)).toEqual([]);
  });

  it("is covered by .gitignore", () => {
    for (const p of ["mods/local/x/manifest.json", "mods/pack.zip", "client/public/mods-user/x/manifest.json"]) {
      expect(spawnSync("git", ["check-ignore", "-q", p], { cwd: REPO }).status, p).toBe(0);
    }
  });

  it("makes the script fail when a file under mods/local/ is staged, even forced, and pass otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "undercut-guard-"));
    try {
      const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
      git("init", "-q");
      mkdirSync(join(dir, "scripts"));
      for (const f of ["check-no-local-mods.mjs", "localGuard.mjs"]) copyFileSync(join(SCRIPTS, f), join(dir, "scripts", f));
      writeFileSync(join(dir, ".gitignore"), "mods/local/\n");
      const run = () => spawnSync("node", ["scripts/check-no-local-mods.mjs"], { cwd: dir, encoding: "utf8" });
      writeFileSync(join(dir, "readme.txt"), "x");
      git("add", "readme.txt");
      expect(run().status).toBe(0);
      mkdirSync(join(dir, "mods/local/secret"), { recursive: true });
      writeFileSync(join(dir, "mods/local/secret/manifest.json"), "{}");
      git("add", "-f", "mods/local/secret/manifest.json");
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("mods/local/secret/manifest.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing private staged in this repository right now", () => {
    expect(spawnSync("node", [join(SCRIPTS, "check-no-local-mods.mjs")], { cwd: REPO, encoding: "utf8" }).status).toBe(0);
  });
});
