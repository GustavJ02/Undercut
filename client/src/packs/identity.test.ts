import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings";
import { driverLabel, driverShortLabel, markColour, teamLabel } from "./identity";
import { createResolver, driverShort } from "./resolve";

const r = createResolver([], () => "");

describe("identity labels", () => {
  it("come from the active pack: its names and short codes, and a derived code for a driver without one", () => {
    expect(driverLabel("XYZ", r)).toBe("Driver XYZ");
    expect(driverShortLabel("XYZ", r)).toBe("XYZ");
    expect(teamLabel("TTT", r)).toBe("Team TTT");
    expect(driverShort({ displayName: "Calla Coverley", number: 3, archetype: "a", helmet: { primary: "#000000", secondary: "#ffffff", pattern: "solid" } })).toBe("COV");
  });
});

describe("settings", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("defaults and round-trips", () => {
    const s = store();
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, scene: true, skipIntro: true }, s);
    expect(loadSettings(s)).toEqual({ ...DEFAULT_SETTINGS, scene: true, skipIntro: true });
  });
  it("keeps the sound mix, and repairs a damaged one", () => {
    const s = store();
    saveSettings({ ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio, master: 0.2, muted: true } }, s);
    expect(loadSettings(s).audio).toEqual({ ...DEFAULT_SETTINGS.audio, master: 0.2, muted: true });
    expect(loadSettings({ getItem: () => '{"audio":{"master":9,"gun":"x"}}' }).audio).toEqual({ ...DEFAULT_SETTINGS.audio, master: 1 });
  });
  it("keeps the chosen pack id only if it is a valid id", () => {
    expect(loadSettings({ getItem: () => '{"pack":"neon-harbour"}' }).pack).toBe("neon-harbour");
    for (const bad of ['{"pack":"../../etc"}', '{"pack":3}', '{"pack":"X"}', "{}"]) expect(loadSettings({ getItem: () => bad }).pack).toBeNull();
  });
  it("survives missing, corrupt or throwing storage", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => "{not json" })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings({ getItem: () => '{"useBundleNames":"yes"}' })).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});

describe("markColour", () => {
  it("uses the primary when it shows on the panel, else the next colour that does, else the text colour", () => {
    expect(markColour({ primary: "#e8334a", secondary: "#ffffff", accent: "#000000" })).toBe("#e8334a");
    expect(markColour({ primary: "#101820", secondary: "#f2c230", accent: "#000000" })).toBe("#f2c230");
    expect(markColour({ primary: "#101820", secondary: "#0a0a0a", accent: "#111111" })).toBe("#e6e9ef");
  });
  it("lightens a primary that is just too dark, so the team still reads as its own colour", () => {
    const c = markColour({ primary: "#6d4aa8", secondary: "#e8e2f2", accent: "#ffb347" });
    expect(c).not.toBe("#e8e2f2");
    expect(c).not.toBe("#6d4aa8");
    expect(parseInt(c.slice(5, 7), 16)).toBeGreaterThan(parseInt(c.slice(1, 3), 16)); // still blue over red: purple, not grey
  });
});
