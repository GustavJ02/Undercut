/** Leak detection for the render model (design section 2.3): structure, names and numbers. Used by the fuzz test, and kept in
 * `src/` so the same check can run in development against live data. */
const ALLOWED: Record<string, string[]> = {
  model: ["contract", "t", "tick", "stateIntervalS", "session", "lighting", "yellowUntilT", "lap", "totalLaps", "circuit", "safetyEnding", "blue", "safetyCar", "weather", "corners", "cars", "pitLane", "cues", "mine"],
  car: ["id", "teamId", "num", "lapFrac", "speed", "status", "compound", "position", "livery"],
  livery: ["primary", "secondary", "accent", "pattern", "number", "image"],
  cue: ["id", "type", "tick", "car", "other", "compound"],
  pit: ["car", "teamId", "sinceT"],
  corner: ["n", "frac"],
  flag: ["lapped", "by"],
  weather: ["raining", "track"],
};

/** Keys that name hidden engine state or things the scene has no business with (`est_` is the team's noisy tyre estimate). */
export const DENY_KEYS = /pace|wear|cliff|^est_|tyre_loss|reliab|draw|seed|plan|damage|launch|stint_s|potential|^lt$|rng|noise|forecast|truth/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Numbers worth searching for: values with at least four decimals, which a rounded public field never equals by chance. */
export function searchable(values: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const v of values) if (Number.isFinite(v) && (String(Math.abs(v)).split(".")[1] ?? "").length >= 4) out.add(v);
  return out;
}

export function findLeaks(model: unknown, hidden: Set<number>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, kind: string | null) => {
    if (typeof v === "number") {
      if (hidden.has(v)) out.push(`${path}: equals a hidden engine value (${v})`);
    } else if (Array.isArray(v)) {
      const child = path.endsWith("cars") ? "car" : path.endsWith("cues") ? "cue" : path.endsWith("pitLane") ? "pit" : path.endsWith("corners") ? "corner" : path.endsWith("blue") ? "flag" : null;
      v.forEach((x, i) => walk(x, `${path}[${i}]`, child));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (DENY_KEYS.test(k)) out.push(`${path}.${k}: key names hidden state`);
        if (kind && !ALLOWED[kind].includes(k)) out.push(`${path}.${k}: not a render model field`);
        walk(x, `${path}.${k}`, k === "livery" ? "livery" : k === "weather" ? "weather" : null);
      }
    }
  };
  walk(model, "model", "model");
  return out;
}
