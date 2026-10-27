// Release check: fails when text that must not be in a public build is found.
//   node scripts/check-denylist.mjs --dist dist     the built page (run by `npm run build`)
//   node scripts/check-denylist.mjs --tree <dir>    a source tree (default: the repository; uses the tracked files when it is a git checkout)
// The denylist is a file of hashes (denylist.sha256); see denylist-lib.mjs. One sentence is allowed, in one place only: the disclaimer in
// src/legal.ts (in a build, in the chunk made from that file). The same sentence anywhere else is refused like any other hit.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findTerms, withoutDisclaimer } from "./denylist-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const hashes = new Set(readFileSync(join(here, "denylist.sha256"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")));
const legal = readFileSync(join(repo, "client/src/legal.ts"), "utf8");
const DISCLAIMER = /export const DISCLAIMER = "([^"]+)"/.exec(legal)?.[1];
if (!DISCLAIMER) throw new Error("check-denylist: could not read DISCLAIMER from client/src/legal.ts");

const SKIP_DIRS = new Set(["node_modules", ".git", "venv", "__pycache__", ".pytest_cache", ".ruff_cache", "dist"]);
const SKIP_FILES = /(^|\/)(package-lock\.json|denylist\.sha256)$|\.(png|jpe?g|gif|webp|ico|wav|ogg|mp3|woff2?|ttf|otf|pyc|zip)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else out.push(p);
  }
  return out;
}

function listFiles(root, dist) {
  if (!dist && existsSync(join(root, ".git"))) {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).map((f) => join(root, f));
  }
  return walk(root);
}

function scan(root, dist) {
  const bad = [];
  for (const file of listFiles(root, dist)) {
    const rel = relative(root, file).split("\\").join("/");
    if (SKIP_FILES.test(rel) || !existsSync(file)) continue;
    let text = readFileSync(file, "utf8");
    text = withoutDisclaimer(rel, text, DISCLAIMER, dist);
    for (const hit of findTerms(text, hashes, { minified: dist && /\.(m?js|css)$/.test(rel) })) {
      const line = text.slice(0, hit.index).split("\n").length;
      bad.push(`${rel}:${line}: "${hit.term}"`);
    }
  }
  return bad;
}

const dist = opt("--dist");
const root = dist ? resolve(dist) : resolve(opt("--tree") ?? repo);
const bad = scan(root, !!dist);
if (bad.length) {
  console.error(`denylist: ${bad.length} hit(s) in ${dist ? "the build" : "the tree"} ${root}`);
  for (const b of bad.slice(0, 200)) console.error("  " + b);
  if (bad.length > 200) console.error(`  ... and ${bad.length - 200} more`);
  process.exit(1);
}
console.log(`denylist: clean (${dist ? "build" : "tree"} ${root})`);
