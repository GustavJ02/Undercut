import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { audio } from "./audio/instance";
import { emptyResolver } from "./packs/browser";
import { driverLabel, driverShortLabel, driverSurname, markColour, teamLabel } from "./packs/identity";
import { registry } from "./packs/registry";
import type { Resolver } from "./packs/resolve";
import type { ModelStore } from "./render/store";
import { CHANGED, currentSettings, type Settings } from "./settings";

/** The saved settings, live: re-renders when any component saves a change. */
export function useSettings(): Settings {
  const subscribe = (cb: () => void) => {
    window.addEventListener(CHANGED, cb);
    window.addEventListener("storage", cb); // a change made in another tab of this browser
    return () => {
      window.removeEventListener(CHANGED, cb);
      window.removeEventListener("storage", cb);
    };
  };
  const snapshot = (): string => JSON.stringify(currentSettings());
  return JSON.parse(useSyncExternalStore(subscribe, snapshot)) as Settings;
}

export function usePrefersReducedMotion(): boolean {
  const q = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null);
  const [reduced, setReduced] = useState(() => q()?.matches ?? false);
  useEffect(() => {
    const m = q();
    if (!m) return;
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Connects the race's render model to the audio engine, applies the saved volumes, and unlocks audio at the first click or key press
 * (browsers do not allow sound before one). */
export function useAudio(store: ModelStore): void {
  const { audio: mix } = useSettings();
  useEffect(() => {
    audio.setSettings(mix);
  }, [mix]);
  useEffect(() => {
    audio.attach(store);
    return () => audio.attach(null);
  }, [store]);
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    audio.unlock(); // works at once if the page already had a gesture (the landing page's button)
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}

/** Loads the content packs once, keeps the active mod in step with the saved choice, and calls `onChange` with a fresh resolver whenever
 * the packs or the choice change (the first time as soon as they are loaded). */
export function usePacks(onChange: (r: Resolver) => void): void {
  const { pack } = useSettings();
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    registry.setActive(pack);
  }, [pack]);
  useEffect(() => {
    const apply = () => cb.current(registry.resolver());
    const off = registry.subscribe(apply);
    registry.setActive(currentSettings().pack);
    void registry.ensure().then(apply, (e) => console.error(e));
    return off;
  }, []);
}

/** A log that reads oldest first: scroll it to the newest line whenever `count` changes, unless the reader has scrolled up to look back. */
export function useStickToBottom<T extends HTMLElement>(count: number) {
  const ref = useRef<T>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  const onScroll = () => {
    const el = ref.current;
    if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return { ref, onScroll };
}

/** The colour that marks the player's cars, from the picked team's livery in the active pack. */
export function useMyColour(team: string | undefined): string {
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  return markColour(resolver.team(team ?? "").colours);
}

/** Names and short codes of teams and drivers from the active pack, for every screen: an ID is never shown. */
export interface Names {
  driver: (id: string) => string;
  driverShort: (id: string) => string;
  surname: (id: string) => string;
  team: (id: string) => string;
  teamShort: (id: string) => string;
  circuit: (id: string, fallback: string) => string;
  resolver: Resolver;
}

export function useNames(): Names {
  const [resolver, setResolver] = useState<Resolver>(() => emptyResolver());
  usePacks(setResolver);
  return {
    driver: (id) => driverLabel(id, resolver),
    driverShort: (id) => driverShortLabel(id, resolver),
    surname: (id) => driverSurname(id, resolver),
    team: (id) => teamLabel(id, resolver),
    teamShort: (id) => resolver.team(id).short,
    circuit: (id, fallback) => resolver.circuitName(id) ?? fallback,
    resolver,
  };
}
