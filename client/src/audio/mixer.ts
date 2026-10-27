/** The volume mix: a master level, one level per category and a mute, saved with the other settings. Pure, so it is tested without
 * an audio device. */
export const BUSES = ["engines", "ambience", "radio", "gun"] as const;
export type Bus = (typeof BUSES)[number];

export interface AudioSettings {
  master: number;
  engines: number;
  ambience: number;
  radio: number;
  gun: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.6, engines: 0.7, ambience: 0.35, radio: 0.7, gun: 0.7, muted: false };

export const BUS_LABELS: Record<Bus, string> = { engines: "Cars passing", ambience: "Garage", radio: "Radio", gun: "Pit gun" };

const level = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : d);

/** Whatever was saved, made into valid settings: missing or odd values fall back to the defaults. */
export function sanitizeAudio(raw: unknown): AudioSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    master: level(r.master, DEFAULT_AUDIO.master),
    engines: level(r.engines, DEFAULT_AUDIO.engines),
    ambience: level(r.ambience, DEFAULT_AUDIO.ambience),
    radio: level(r.radio, DEFAULT_AUDIO.radio),
    gun: level(r.gun, DEFAULT_AUDIO.gun),
    muted: r.muted === true,
  };
}

/** The gain a category plays at: nothing when muted, otherwise master times the category's level. */
export const busGain = (s: AudioSettings, bus: Bus): number => (s.muted ? 0 : s.master * s[bus]);
