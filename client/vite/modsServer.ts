/** Serving content packs to the dev page, and listing them: pure functions over the file system, tested without a server.
 *
 * Search order (later wins is not used for serving: every pack is served under its source): `examples` (in the repo), `local`
 * (gitignored, for the owner's real-identity packs) and `user` (the per-user data folder). A request path is
 * `/mods/<source>/<folder>/<file>`; anything that is not a plain file of an allowed type inside a pack folder is refused, links are
 * never followed, and the same validator the CLI uses decides which packs are listed as usable. */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { packDirs, readPackDir } from "../src/packs/readDir";
import { formatIssues, validatePack, pathProblem } from "../src/packs/validate";

export type Roots = Record<string, string>; // source name -> folder

export interface ModEntry {
  source: string;
  folder: string;
  root: string; // URL prefix the page loads the pack from
  ok: boolean;
  id?: string;
  name?: string;
  version?: string;
  author?: string;
  errors: string[];
}

const TYPES: Record<string, string> = { json: "application/json", png: "image/png", webp: "image/webp", svg: "image/svg+xml", ogg: "audio/ogg", wav: "audio/wav" };

/** Every pack in every root, validated. A broken pack is listed with its errors, not hidden. */
export function scanMods(roots: Roots): ModEntry[] {
  const out: ModEntry[] = [];
  for (const [source, dir] of Object.entries(roots)) {
    for (const packDir of packDirs(dir)) {
      const folder = packDir.split(sep).pop()!;
      const entry: ModEntry = { source, folder, root: `/mods/${source}/${encodeURIComponent(folder)}`, ok: false, errors: [] };
      try {
        const { manifest, errors } = validatePack(readPackDir(packDir));
        if (manifest) Object.assign(entry, { ok: manifest.kind === "mod", id: manifest.id, name: manifest.name, version: manifest.version, author: manifest.author });
        if (manifest && manifest.kind !== "mod") entry.errors.push(`${manifest.id}:manifest.json.kind: only the built-in pack may have kind 'base' (set it to 'mod')`);
        if (errors.length) entry.errors.push(...formatIssues(manifest?.id ?? folder, errors).split("\n"));
      } catch (e) {
        entry.errors.push(`${folder}: cannot be read (${(e as Error).message})`);
      }
      out.push(entry);
    }
  }
  return out;
}

export interface Served {
  status: number;
  type?: string;
  body?: Buffer;
}

/** The file for a request path under `/mods/`, or the reason it is refused. */
export function resolveModRequest(roots: Roots, urlPath: string): Served {
  let parts: string[];
  try {
    parts = urlPath.split("?")[0].replace(/^\/+/, "").split("/").map(decodeURIComponent);
  } catch {
    return { status: 400 };
  }
  const [source, folder, ...rest] = parts;
  if (!source || !folder || !rest.length || !(source in roots)) return { status: 404 };
  const rel = rest.join("/");
  if (pathProblem(rel) || pathProblem(folder) || folder.includes("/")) return { status: 400 };
  const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!(ext in TYPES)) return { status: 404 };
  const packRoot = join(roots[source], folder);
  const file = join(packRoot, rel);
  try {
    // every step must be a real file or folder: no links, and the resolved path must stay inside the pack
    let at = packRoot;
    if (lstatSync(at).isSymbolicLink()) return { status: 403 };
    for (const seg of rel.split("/")) {
      at = join(at, seg);
      if (lstatSync(at).isSymbolicLink()) return { status: 403 };
    }
    if (!lstatSync(file).isFile()) return { status: 404 };
    if (!realpathSync(file).startsWith(realpathSync(packRoot) + sep)) return { status: 403 };
    return { status: 200, type: TYPES[ext], body: readFileSync(file) };
  } catch {
    return { status: 404 };
  }
}
