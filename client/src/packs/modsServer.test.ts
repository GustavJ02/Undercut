import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveModRequest, scanMods } from "../../vite/modsServer";
import { minimal, png } from "./testkit";

const EXAMPLES = resolve(__dirname, "../../../mods/examples");
let tmp: string;
let roots: Record<string, string>;
const write = (rel: string, data: string | Uint8Array) => {
  mkdirSync(join(tmp, rel, ".."), { recursive: true });
  writeFileSync(join(tmp, rel), data);
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "undercut-mods-"));
  write("local/good/manifest.json", JSON.stringify(minimal({ id: "good-mod", name: "Good" })));
  write("local/good/assets/a.png", png());
  write("local/good/assets/notes.txt", "x");
  write("local/bad/manifest.json", JSON.stringify({ ...minimal({ id: "bad-mod" }), script: "x.js" }));
  write("local/claims/manifest.json", JSON.stringify(minimal({ id: "claims", kind: "base" })));
  write("secret.png", png());
  symlinkSync(join(tmp, "secret.png"), join(tmp, "local/good/assets/link.png"));
  roots = { examples: EXAMPLES, local: join(tmp, "local"), user: join(tmp, "no-such-folder") };
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("scanMods", () => {
  let entries: ReturnType<typeof scanMods>;
  beforeAll(() => {
    entries = scanMods(roots);
  });
  const by = (folder: string) => entries.find((e) => e.folder === folder)!;

  it("lists the example mod as usable and gives its URL", () => {
    expect(by("neon-harbour")).toMatchObject({ source: "examples", ok: true, id: "neon-harbour", root: "/mods/examples/neon-harbour", errors: [] });
  });
  it("lists a pack with a symlink as not usable, and says which file", () => {
    expect(by("good").ok).toBe(false);
    expect(by("good").errors.join("\n")).toContain("assets/link.png: symbolic links are not allowed");
  });
  it("lists a broken pack with readable errors, and a pack claiming to be base as not usable", () => {
    expect(by("bad").ok).toBe(false);
    expect(by("bad").errors.join("\n")).toContain("unknown key 'script'");
    expect(by("claims").errors.join("\n")).toContain("only the built-in pack may have kind 'base'");
  });
  it("skips a root that does not exist", () => {
    expect(entries.filter((e) => e.source === "user")).toEqual([]);
  });
});

describe("resolveModRequest", () => {
  it("serves a file of an allowed type from a pack, with its type", () => {
    const r = resolveModRequest(roots, "/examples/neon-harbour/manifest.json");
    expect(r.status).toBe(200);
    expect(r.type).toBe("application/json");
    expect(JSON.parse(r.body!.toString()).id).toBe("neon-harbour");
    expect(resolveModRequest(roots, "/examples/neon-harbour/assets/gun.wav")).toMatchObject({ status: 200, type: "audio/wav" });
    expect(resolveModRequest(roots, "/local/good/assets/a.png")).toMatchObject({ status: 200, type: "image/png" });
  });
  it("refuses path traversal in every spelling", () => {
    for (const p of ["/examples/neon-harbour/../../../package.json", "/examples/neon-harbour/%2e%2e/%2e%2e/package.json", "/examples/..%2fneon-harbour/manifest.json", "/local/good/assets/..%5c..%5csecret.png", "/examples/neon-harbour//manifest.json", "/examples/neon-harbour/assets/%00.png"])
      expect(resolveModRequest(roots, p).status, p).not.toBe(200);
  });
  it("refuses links, unknown sources, folders and files, and file types a pack may not hold", () => {
    expect(resolveModRequest(roots, "/local/good/assets/link.png").status).toBe(403);
    expect(resolveModRequest(roots, "/etc/passwd").status).toBe(404);
    expect(resolveModRequest(roots, "/examples/nope/manifest.json").status).toBe(404);
    expect(resolveModRequest(roots, "/examples/neon-harbour/missing.png").status).toBe(404);
    expect(resolveModRequest(roots, "/local/good/assets/notes.txt").status).toBe(404);
    expect(resolveModRequest(roots, "/examples/neon-harbour/assets").status).toBe(404);
    expect(resolveModRequest(roots, "/examples/neon-harbour").status).toBe(404);
    expect(resolveModRequest(roots, "/examples/neon-harbour/%E0%A4%A.png").status).toBe(400);
  });
});
