/** Loading packs: validate every candidate, keep the good ones, and report the rest with readable errors. The base pack is
 * always first; a mod can only add or override entries, and a broken mod never prevents the game from starting. */
import { readPackDir } from "./readDir";
import type { LoadedPack, PackManifest } from "./types";
import { formatIssues, validatePack, type PackFile } from "./validate";

export interface LoadResult {
  packs: LoadedPack[]; // base first, then mods in discovery order
  rejected: { root: string; report: string }[];
}

export function loadFiles(root: string, files: PackFile[]): { pack?: LoadedPack; report?: string } {
  const { manifest, errors } = validatePack(files);
  if (!manifest) return { report: formatIssues(rootName(root), errors) };
  return { pack: { manifest, files: files.map((f) => f.path).filter((p) => p !== "manifest.json"), root } };
}

const rootName = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

/** Load the base pack from `baseDir`, then every pack folder in `modDirs`. A mod with `kind: "base"` or a duplicate id is rejected. */
export function loadPacks(baseDir: string, modDirs: string[]): LoadResult {
  const rejected: LoadResult["rejected"] = [];
  const base = loadFiles(baseDir, readPackDir(baseDir));
  if (!base.pack) throw new Error(`the base pack is broken:\n${base.report}`);
  if (base.pack.manifest.kind !== "base") throw new Error("the base pack must have kind 'base'");
  const packs = [base.pack];
  for (const dir of modDirs) {
    let loaded: ReturnType<typeof loadFiles>;
    try {
      loaded = loadFiles(dir, readPackDir(dir));
    } catch (e) {
      rejected.push({ root: dir, report: `${rootName(dir)}: cannot be read (${(e as Error).message})` });
      continue;
    }
    const m: PackManifest | undefined = loaded.pack?.manifest;
    if (!loaded.pack || !m) rejected.push({ root: dir, report: loaded.report ?? "" });
    else if (m.kind !== "mod") rejected.push({ root: dir, report: `${m.id}:manifest.json.kind: only the built-in pack may have kind 'base' (set it to 'mod')` });
    else if (packs.some((p) => p.manifest.id === m.id)) rejected.push({ root: dir, report: `${m.id}:manifest.json.id: another pack already uses this id` });
    else packs.push(loaded.pack);
  }
  return { packs, rejected };
}
