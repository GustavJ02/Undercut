/** Reads a pack folder from disk for the Node CLI, tests and the dev server. Symbolic links are reported, never followed, and
 * file contents are read only for files small enough to pass the size checks (the validator reports the rest by size). */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LIMITS, type PackFile } from "./validate";

const READ_UP_TO = Math.max(LIMITS.imageBytes, LIMITS.audioBytes, LIMITS.svgBytes, LIMITS.manifestBytes);

export function readPackDir(root: string): PackFile[] {
  const out: PackFile[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      if (out.length > LIMITS.files) return; // enough to report "too many files" without walking a huge tree
      const p = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(root, p));
      if (st.isSymbolicLink()) out.push({ path: p, size: st.size, symlink: true });
      else if (st.isDirectory()) walk(p);
      else out.push({ path: p, size: st.size, bytes: st.size <= READ_UP_TO ? new Uint8Array(readFileSync(join(root, p))) : undefined });
    }
  };
  walk("");
  return out;
}

/** Where packs are looked for, in override order (later wins): repo examples, repo-local, then the user's data folder. */
export function packRoots(repoRoot: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string[] {
  const user =
    platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "undercut", "mods")
      : platform === "win32"
        ? join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "undercut", "mods")
        : join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "undercut", "mods");
  return [join(repoRoot, "mods", "examples"), join(repoRoot, "mods", "local"), user];
}

/** The pack folders inside a root (one level), or none when the root does not exist. */
export function packDirs(root: string): string[] {
  try {
    return readdirSync(root)
      .sort()
      .map((n) => join(root, n))
      .filter((d) => lstatSync(d).isDirectory());
  } catch {
    return [];
  }
}
