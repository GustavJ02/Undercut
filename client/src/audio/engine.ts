/** The audio engine: one AudioContext, one gain per category behind a master, and the logic that turns the render model into sounds:
 * a pass-by when a car comes onto the screen, wheel guns when the player's car stops, a radio blip for each radio line, and the
 * garage's background with the odd clank. It reads only the render model and its cues. Browsers only let audio start after a user
 * gesture, so nothing sounds until `unlock()` is called from one. A pack can replace any sound with a file. */
import { PX_PER_LAP, trackX } from "../scene/cars/lane";
import type { ModelStore } from "../render/store";
import type { SoundName } from "../packs/types";
import { BUSES, DEFAULT_AUDIO, busGain, type AudioSettings, type Bus } from "./mixer";
import { LIGHTS, lightTime } from "../startSequence";
import { clank, enginePass, garageBed, lightsOutRoar, pitGun, radioBlip, startBeep } from "./synth";
import { PassGate, nextClankDelay, passVoice } from "./voices";

export interface AudioStats {
  state: string;
  passes: number;
  guns: number;
  beeps: number;
  starts: number;
  radios: number;
  clanks: number;
  overrides: string[];
}

declare global {
  interface Window {
    __undercutAudio?: AudioStats;
  }
}

const SOUND_NAMES: SoundName[] = ["passBy", "ambience", "radioOpen", "radioClose", "gun"];
const TICK_MS = 50;
const FROM_LEFT_PX = 600;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = {} as Record<Bus, GainNode>;
  private settings: AudioSettings = { ...DEFAULT_AUDIO };
  private store: ModelStore | null = null;
  private cursor = 0;
  private session: string | undefined;
  private gate = new PassGate();
  private prevX = new Map<string, number | null>();
  private overrides: Partial<Record<SoundName, AudioBuffer>> = {};
  private overridesFor = -1;
  private bed: { stop: () => void } | null = null;
  private nextClank = 0;
  private timer: number | undefined;
  readonly stats: AudioStats = { state: "locked", passes: 0, guns: 0, beeps: 0, starts: 0, radios: 0, clanks: 0, overrides: [] };

  setSettings(s: AudioSettings): void {
    this.settings = s;
    this.applyGains();
  }

  private applyGains() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(1, t, 0.02);
    for (const b of BUSES) this.buses[b].gain.setTargetAtTime(busGain(this.settings, b), t, 0.04); // a short ramp: no clicks when a slider moves
  }

  /** Start the audio. Call from a click or key press. Safe to call again. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = typeof window !== "undefined" ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const b of BUSES) {
      this.buses[b] = ctx.createGain();
      this.buses[b].gain.value = 0;
      this.buses[b].connect(this.master);
    }
    this.applyGains();
    void ctx.resume();
    this.startBed();
    this.nextClank = ctx.currentTime + 2;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.publish();
  }

  attach(store: ModelStore | null): void {
    this.store = store;
    this.cursor = store ? store.cueEnd : 0; // what happened before is not sounded
    this.session = undefined;
    this.prevX.clear();
    this.overridesFor = -1;
  }

  /** Stop everything and release the audio device (for tests and for leaving the page). */
  close(): void {
    window.clearInterval(this.timer);
    this.bed?.stop();
    void this.ctx?.close();
    this.ctx = this.master = this.bed = null;
    this.stats.state = "closed";
  }

  private startBed() {
    this.bed?.stop();
    if (this.ctx) this.bed = garageBed(this.ctx, this.buses.ambience, this.overrides.ambience);
  }

  /** The wheel guns of a pit stop. */
  gun(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    pitGun(this.ctx, this.buses.gun, this.ctx.currentTime + 0.02, this.overrides.gun);
    this.stats.guns++;
  }

  /** The start sequence: a beep with each light as it comes on (timing from `startSequence`). The roar comes with the lights-out cue. */
  startLights(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < LIGHTS; i++) startBeep(this.ctx, this.buses.engines, t + lightTime(i));
    this.stats.beeps += LIGHTS;
  }

  private async loadOverrides(store: ModelStore) {
    const ctx = this.ctx;
    if (!ctx) return;
    const next: Partial<Record<SoundName, AudioBuffer>> = {};
    for (const name of SOUND_NAMES) {
      const url = store.resolver.sound(name);
      if (!url) continue;
      try {
        const r = await fetch(url);
        next[name] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) {
        console.warn(`[undercut audio] could not load the pack's ${name} (${url}); using the synthesised sound`, e);
      }
    }
    this.overrides = next;
    this.stats.overrides = Object.keys(next);
    if (this.overrides.ambience || this.bed) this.startBed();
  }

  private tick() {
    const ctx = this.ctx;
    const store = this.store;
    if (!ctx) return;
    this.stats.state = ctx.state;
    if (ctx.state !== "running") {
      if (ctx.state === "suspended") void ctx.resume();
      this.publish();
      return;
    }
    const now = performance.now();
    if (store?.model) {
      if (this.overridesFor !== store.version) {
        this.overridesFor = store.version;
        void this.loadOverrides(store);
      }
      this.passes(store, now, ctx);
      this.cues(store, ctx);
    }
    if (ctx.currentTime >= this.nextClank) {
      clank(ctx, this.buses.ambience, ctx.currentTime + 0.01, 0.85 + Math.random() * 0.4);
      this.stats.clanks++;
      this.nextClank = ctx.currentTime + nextClankDelay(Math.random());
    }
    this.publish();
  }

  private passes(store: ModelStore, now: number, ctx: AudioContext) {
    const m = store.model!;
    const screen: { id: string; fromLeft: boolean }[] = [];
    for (const c of m.cars) {
      const x = c.status === "RUNNING" ? trackX(store.lapFrac(c, now)) : null;
      const before = this.prevX.get(c.id) ?? null;
      this.prevX.set(c.id, x);
      if (x !== null) screen.push({ id: c.id, fromLeft: before === null && x < FROM_LEFT_PX }); // first seen at the left edge: it has just come in
    }
    const speedOf = (id: string) => Math.max((m.cars.find((c) => c.id === id)?.speed ?? 0) * PX_PER_LAP * store.speed, 200);
    const fire = this.gate.update(screen, now, (id) => passVoice(id, speedOf(id), store.speed).duration * 1000);
    for (const id of fire) {
      enginePass(ctx, this.buses.engines, ctx.currentTime + 0.02, passVoice(id, speedOf(id), store.speed), this.overrides.passBy);
      this.stats.passes++;
    }
  }

  private cues(store: ModelStore, ctx: AudioContext) {
    // the race starting is the grid session ending: the server sends no lights-out event while the page is open
    const session = store.model?.session;
    if (this.session === "GRID" && session && session !== "GRID") {
      lightsOutRoar(ctx, this.buses.engines, ctx.currentTime + 0.02);
      this.stats.starts++;
    }
    this.session = session;
    const { cues, next } = store.cuesSince(this.cursor);
    this.cursor = next;
    for (const c of cues) {
      if (c.type !== "radio") continue;
      radioBlip(ctx, this.buses.radio, ctx.currentTime + 0.02, true, this.overrides.radioOpen);
      radioBlip(ctx, this.buses.radio, ctx.currentTime + 1.7, false, this.overrides.radioClose);
      this.stats.radios++;
    }
  }

  private publish() {
    window.__undercutAudio = { ...this.stats, overrides: [...this.stats.overrides] };
  }
}
