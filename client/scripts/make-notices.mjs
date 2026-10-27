// Writes the third-party licence notices into the build: every package the page ships (the production dependencies of client/ and what
// they pull in), with its version, licence and licence text, followed by the server's notices (../NOTICES-server.txt, made by
// tools/make_notices.py). MIT, ISC and BSD licences require their notice to travel with the code.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, "..");
const repo = resolve(client, "..");
const pkgOf = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

/** Find `name` the way node resolves it: in `from`'s node_modules, then in the ones above it. */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const p = join(dir, "node_modules", name);
    if (existsSync(join(p, "package.json"))) return p;
    if (dirname(dir) === dir) return null;
  }
}

const seen = new Map();
(function visit(dir) {
  const pkg = pkgOf(dir);
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    const p = locate(dep, dir);
    if (!p || seen.has(p)) continue;
    seen.set(p, pkgOf(p));
    visit(p);
  }
})(client);

const licenceText = (dir) => {
  const f = readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.|$)/i.test(n));
  return f ? readFileSync(join(dir, f), "utf8").trim() : null;
};
const licence = (pkg) => (typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type ?? l).join(" OR ")) || "unknown";

const parts = ["THIRD-PARTY NOTICES", "", "This page and its server use the open-source software below, under the licences shown.", ""];
for (const [dir, pkg] of [...seen].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const text = licenceText(dir);
  parts.push("=".repeat(78), `${pkg.name} ${pkg.version}  (${licence(pkg)})`, pkg.homepage ?? pkg.repository?.url ?? "", "", text ?? `Licence: ${licence(pkg)}. The package ships no licence file.`, "");
}
const server = join(repo, "NOTICES-server.txt");
if (existsSync(server)) parts.push("=".repeat(78), "SERVER", "", readFileSync(server, "utf8"));
const dist = join(client, "dist");
writeFileSync(join(dist, "THIRD_PARTY_NOTICES.txt"), parts.join("\n") + "\n");
console.log(`notices: ${seen.size} packages${existsSync(server) ? " and the server's" : ""} written to dist/THIRD_PARTY_NOTICES.txt`);
