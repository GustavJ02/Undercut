/** Loading a pack in the browser: fetch the manifest and the assets it names, then run the same validator as the CLI. The base
 * pack is served from `/packs/base-fictional/` (client/public); mod discovery over HTTP arrives with the mod manager (P6). */
import { createResolver, type Resolver } from "./resolve";
import type { LoadedPack, PackManifest } from "./types";
import { formatIssues, referencedAssets, validatePack, type PackFile } from "./validate";

export const BASE_PACK_URL = "/packs/base-fictional";
export const urlFor = (p: LoadedPack, path: string) => `${p.root}/${path}`;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function loadPackFromUrl(root: string): Promise<LoadedPack> {
  const manifestBytes = await fetchBytes(`${root}/manifest.json`);
  const files: PackFile[] = [{ path: "manifest.json", size: manifestBytes.length, bytes: manifestBytes }];
  let manifest: PackManifest | undefined;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    /* the validator reports invalid JSON */
  }
  for (const [, path] of manifest ? referencedAssets(manifest) : []) {
    try {
      const bytes = await fetchBytes(`${root}/${path}`);
      files.push({ path, size: bytes.length, bytes });
    } catch {
      /* missing: the validator reports the reference */
    }
  }
  const result = validatePack(files);
  if (!result.manifest) throw new Error(`pack ${root} is invalid:\n${formatIssues(root, result.errors)}`);
  return { manifest: result.manifest, files: files.map((f) => f.path).filter((p) => p !== "manifest.json"), root };
}

/** A resolver with no packs: every id gets its generated identity. Used until the base pack has loaded, and if it cannot. */
export const emptyResolver = (): Resolver => createResolver([], urlFor);

export async function loadResolver(): Promise<Resolver> {
  return createResolver([await loadPackFromUrl(BASE_PACK_URL)], urlFor);
}
