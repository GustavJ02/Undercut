/** Per-viewer presentation settings, kept in localStorage when it is available and in memory otherwise. */
import { DEFAULT_AUDIO, sanitizeAudio, type AudioSettings } from "./audio/mixer";

export interface Settings {
  /** Show the bundle's team and driver names in the timing UI (design decision D29). Off shows the active pack's names. */
  /** Draw the track with the Pixi scene instead of the plain SVG map. */
  scene: boolean;
  /** Skip the landing page and the move into the pit wall. */
  skipIntro: boolean;
  /** Volumes and mute. */
  audio: AudioSettings;
  /** The id of the content-pack mod in use, or null for the base pack. */
  pack: string | null;
}

export const DEFAULT_SETTINGS: Settings = { scene: false, skipIntro: false, audio: DEFAULT_AUDIO, pack: null };
const KEY = "undercut.settings";

/** `localStorage` can be absent or throw on access (private window, blocked site data, Node). */
function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): Settings {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "{}");
    const flag = (k: "scene" | "skipIntro") => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : DEFAULT_SETTINGS[k]);
    return { scene: flag("scene"), skipIntro: flag("skipIntro"), audio: sanitizeAudio(raw.audio), pack: typeof raw.pack === "string" && /^[a-z0-9-]{3,40}$/.test(raw.pack) ? raw.pack : null };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  memory = s;
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private window or blocked storage: the setting just lasts for this page */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

// what this page last saved, so a setting still works when storage is blocked
let memory: Settings | null = null;
export const CHANGED = "undercut-settings";
export const currentSettings = (): Settings => memory ?? loadSettings();
