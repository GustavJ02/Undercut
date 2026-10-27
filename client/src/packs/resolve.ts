/** ID to identity resolution. Engine and gameplay code only know stable IDs (`VMR`, `ALD`); everything shown or drawn about
 * them comes from here. Lookup order: the active mod, other mods (latest first), the base pack, then an identity generated
 * from the ID itself, so an unknown ID never crashes and never produces a real name. */
import type { Archetype, DriverIdentity, LoadedPack, SoundName, TeamIdentity } from "./types";

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const PATTERNS = ["solid", "stripe", "chevron", "split", "hoops", "diagonal", "dots"] as const;

export function generatedTeam(id: string): TeamIdentity {
  const h = hash(id);
  const hue = h % 360;
  return {
    displayName: `Team ${id}`,
    short: id.replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(2, "X"),
    colours: { primary: hsl(hue, 0.55, 0.45), secondary: hsl((hue + 180) % 360, 0.2, 0.9), accent: hsl((hue + 60) % 360, 0.8, 0.55) },
    livery: { pattern: PATTERNS[(h >>> 9) % PATTERNS.length] },
    crew: { kit: hsl(hue, 0.55, 0.45), helmet: hsl((hue + 180) % 360, 0.2, 0.9) },
  };
}

/** The code a driver is shown by: the pack's, or the first three letters of the surname. */
export const driverShort = (d: DriverIdentity): string => d.short ?? (d.displayName.split(" ").pop() ?? d.displayName).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");

export function generatedDriver(id: string): DriverIdentity {
  const h = hash(id);
  return {
    displayName: `Driver ${id}`,
    short: id.replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X"),
    number: (h % 99) + 1,
    archetype: "generated",
    helmet: { primary: hsl(h % 360, 0.6, 0.5), secondary: hsl((h >>> 8) % 360, 0.3, 0.85), pattern: PATTERNS[(h >>> 17) % PATTERNS.length] },
  };
}

const GENERATED_ARCHETYPE: Archetype = { role: "crew", build: "medium", height: 1, hair: "short", skin: "#c58c63" };

export interface Resolver {
  team(id: string): TeamIdentity;
  driver(id: string): DriverIdentity & { short: string };
  /** The pack's name for a circuit, or undefined to use the circuit's own. */
  circuitName(id: string): string | undefined;
  archetype(id: string): Archetype;
  /** Ids of the archetypes with a role, the active mod's first, then the others, base last; no id twice. */
  archetypeIds(role: Archetype["role"]): string[];
  /** URL of a team's livery image, through the pack that owns the team's entry, or undefined when it has none. */
  teamImageUrl(id: string): string | undefined;
  /** URL of the pack's file for a sound, or undefined to use the synthesised default. */
  sound(name: SoundName): string | undefined;
}

/** `packs` in load order (base first). `active` is the id of the chosen mod, which wins over everything else. */
export function createResolver(packs: LoadedPack[], urlFor: (pack: LoadedPack, path: string) => string, active?: string): Resolver {
  // the active mod first, then the others latest first, so base is tried last
  const chain = [...packs.filter((p) => p.manifest.id === active), ...packs.filter((p) => p.manifest.id !== active).reverse()];
  const pick = <T>(get: (p: LoadedPack) => T | undefined): T | undefined => {
    for (const p of chain) {
      const v = get(p);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  return {
    team: (id) => pick((p) => p.manifest.teams?.[id]) ?? generatedTeam(id),
    driver: (id) => {
      const d = pick((p) => p.manifest.drivers?.[id]) ?? generatedDriver(id);
      return { ...d, short: driverShort(d) };
    },
    circuitName: (id) => pick((p) => p.manifest.circuits?.[id]?.displayName),
    archetype: (id) => pick((p) => p.manifest.archetypes?.[id]) ?? GENERATED_ARCHETYPE,
    archetypeIds: (role) => {
      const out: string[] = [];
      for (const p of chain) for (const [id, a] of Object.entries(p.manifest.archetypes ?? {})) if (a.role === role && !out.includes(id) && pick((q) => q.manifest.archetypes?.[id])?.role === role) out.push(id);
      return out;
    },
    teamImageUrl: (id) => {
      for (const p of chain) {
        const t = p.manifest.teams?.[id];
        if (t) return t.livery.image ? urlFor(p, t.livery.image) : undefined;
      }
      return undefined;
    },
    sound: (name) => {
      for (const p of chain) {
        const path = p.manifest.sounds?.[name];
        if (path) return urlFor(p, path);
      }
      return undefined;
    },
  };
}
