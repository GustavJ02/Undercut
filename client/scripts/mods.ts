// The content-pack tool. Run from client/ with npm:
//   npm run mods:validate -- <pack folder | folder of packs> ...   check packs; exit 1 if any has an error
//   npm run mods:list                                               every pack found in the search folders, and whether it is usable
//   npm run mods:init -- <id> [--name "Display name"]               start a pack in mods/local/<id>/ from the base pack's ids
// Errors read `pack:path: message`; see docs/modding.md. Nothing here executes pack content.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { packDirs, packRoots, readPackDir } from "../src/packs/readDir";
import { formatIssues, validatePack } from "../src/packs/validate";
import type { PackManifest } from "../src/packs/types";

const REPO = resolve(__dirname, "../..");
const BASE = join(REPO, "client", "public", "packs", "base-fictional");

function inspect(dir: string): { ok: boolean; line: string; detail?: string } {
  let files;
  try {
    files = readPackDir(dir);
  } catch (e) {
    return { ok: false, line: `FAIL ${dir}`, detail: `${basename(dir)}: cannot be read (${(e as Error).message})` };
  }
  const { manifest, errors } = validatePack(files);
  if (manifest && !errors.length) {
    const kb = (files.reduce((n, f) => n + f.size, 0) / 1024).toFixed(1);
    return { ok: true, line: `OK   ${manifest.id}@${manifest.version} (${manifest.kind}, ${files.length} files, ${kb} KB)  ${dir}` };
  }
  return { ok: false, line: `FAIL ${dir}`, detail: formatIssues(manifest?.id ?? basename(dir), errors) };
}

function resolvePath(p: string): string {
  if (isAbsolute(p)) return p;
  for (const base of [process.cwd(), REPO]) if (existsSync(resolve(base, p))) return resolve(base, p);
  return resolve(p);
}

/** A folder is a pack when it holds a manifest; otherwise it is a folder of packs. */
function targets(p: string): string[] {
  const dir = resolvePath(p);
  return existsSync(join(dir, "manifest.json")) ? [dir] : packDirs(dir);
}

function validate(paths: string[]): number {
  if (!paths.length) {
    console.error("usage: npm run mods:validate -- <pack folder | folder of packs> ...");
    return 2;
  }
  let failed = 0, n = 0;
  for (const p of paths)
    for (const dir of targets(p)) {
      n++;
      const r = inspect(dir);
      console.log(r.line);
      if (!r.ok) {
        failed++;
        console.log(r.detail!.split("\n").map((l) => `     ${l}`).join("\n"));
      }
    }
  if (!n) console.error(`no packs found in ${paths.join(", ")}`);
  console.log(`${n - failed} of ${n} packs are valid.`);
  return failed || !n ? 1 : 0;
}

function list(): number {
  const names = ["repo examples", "repo local", "user folder"];
  packRoots(REPO).forEach((root, i) => {
    const dirs = packDirs(root);
    console.log(`${names[i]}: ${root}${existsSync(root) ? "" : "  (does not exist)"}`);
    for (const d of dirs) {
      const r = inspect(d);
      console.log(`  ${r.line.slice(0, 4)} ${basename(d)}${r.ok ? "" : ""}`);
      if (!r.ok) console.log(r.detail!.split("\n").map((l) => `       ${l}`).join("\n"));
    }
  });
  return 0;
}

function init(args: string[]): number {
  const id = args[0];
  const nameAt = args.indexOf("--name");
  if (!id || !/^[a-z0-9-]{3,40}$/.test(id)) {
    console.error('usage: npm run mods:init -- <id> [--name "Display name"]   (id: lowercase letters, digits and dashes, 3 to 40)');
    return 2;
  }
  const dir = join(process.env.UNDERCUT_MODS_LOCAL ?? join(REPO, "mods", "local"), id); // the override is for tests
  if (existsSync(dir)) {
    console.error(`${dir} already exists; not overwriting it`);
    return 1;
  }
  const base = JSON.parse(readFileSync(join(BASE, "manifest.json"), "utf8")) as PackManifest;
  const manifest: PackManifest = {
    schema: 1, id, name: nameAt >= 0 ? args[nameAt + 1] : id, version: "0.1.0", author: "me", licence: "all rights reserved", kind: "mod",
    teams: Object.fromEntries(Object.entries(base.teams!).map(([k, t]) => [k, { ...t, displayName: `Team ${k}` }])),
    drivers: Object.fromEntries(Object.entries(base.drivers!).map(([k, d]) => [k, { ...d, displayName: `Driver ${k}` }])),
    archetypes: base.archetypes, sounds: {}, tracks: {},
  };
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Created ${dir}/manifest.json with every team and driver id of the bundle.`);
  console.log("Edit the names, colours, numbers and archetypes, then check it with: npm run mods:validate -- mods/local/" + id);
  console.log("mods/local/ is gitignored: real names and images belong there and are never committed.");
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
const code = cmd === "validate" ? validate(rest) : cmd === "list" ? list() : cmd === "init" ? init(rest) : (console.error("commands: validate, list, init"), 2);
process.exit(code);
