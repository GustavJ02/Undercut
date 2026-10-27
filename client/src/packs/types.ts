/** Content pack types, hand-written to mirror `pack.schema.json` (checked by `schema.test.ts`). A pack is data only. */
export type Pattern = "solid" | "stripe" | "chevron" | "split" | "hoops" | "diagonal" | "dots";
export type SoundName = "passBy" | "ambience" | "radioOpen" | "radioClose" | "gun";

export interface Colours {
  primary: string;
  secondary: string;
  accent: string;
}

export interface TeamIdentity {
  displayName: string;
  short: string;
  colours: Colours;
  livery: { pattern: Pattern; image?: string };
  crew: { kit: string; helmet: string };
  engineers?: string[];
}

export interface DriverIdentity {
  displayName: string;
  /** The three-letter code shown on the timing screens; derived from the name when a pack does not give one. */
  short?: string;
  number: number;
  archetype: string;
  helmet: { primary: string; secondary: string; pattern: Pattern };
}

export interface Archetype {
  role: "crew" | "engineer" | "strategist" | "driver";
  build: "lean" | "medium" | "broad";
  height: number;
  hair: "none" | "short" | "long" | "curly" | "cap" | "tied";
  skin: string;
}

export interface PackManifest {
  schema: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  licence: string;
  kind: "base" | "mod";
  teams?: Record<string, TeamIdentity>;
  drivers?: Record<string, DriverIdentity>;
  archetypes?: Record<string, Archetype>;
  sounds?: Partial<Record<SoundName, string>>;
  /** Display names of circuits, by circuit id, for a pack that names them differently. */
  circuits?: Record<string, { displayName: string }>;
  tracks?: Record<string, never>;
}

/** A pack that passed validation; `files` are the asset paths it ships. */
export interface LoadedPack {
  manifest: PackManifest;
  files: string[];
  root: string;
}
