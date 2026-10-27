/** In development, every server message is checked against the presentation contract and a mismatch is logged once per kind of
 * problem, so a backend change shows up in the console of whoever is looking at the game. Silent in production builds. */
import { checkMessage } from "../contract/contract";

const reported = new Set<string>();

export function reportDrift(msg: unknown): void {
  if (!import.meta.env.DEV) return;
  for (const p of checkMessage(msg)) {
    const kind = p.replace(/\[\d+\]/g, "[]");
    if (reported.has(kind)) continue;
    reported.add(kind);
    console.warn(`[undercut contract v1] ${p}`);
  }
}
