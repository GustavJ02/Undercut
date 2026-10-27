/** The sounds, synthesised with WebAudio: nothing is loaded, so the repo carries no audio and there is no licence question. A pack may
 * replace any of them with a file (see `engine.ts`). Every function schedules short-lived nodes on `ctx` at time `when` into `dest`,
 * and works on an OfflineAudioContext too, which is how the sounds are checked without speakers. */
import { dopplerAt, gunTimes, swellAt, type PassVoice } from "./voices";

const CURVE_POINTS = 48;

/** A second of noise, brown (a random walk), which sounds like wind and rumble rather than hiss. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2, brown = true): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let seed = 12345; // fixed, so the noise is the same every run
  for (let i = 0; i < d.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 4294967296 * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    } else d[i] = white;
  }
  return buf;
}

const curve = (n: number, f: (u: number) => number): Float32Array => Float32Array.from({ length: n }, (_, i) => f(i / (n - 1)));

function noiseSource(ctx: BaseAudioContext, brown = true): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, 1, brown);
  s.loop = true;
  return s;
}

/** A car going past: three oscillators for the engine note and a band of noise for the wind, bent by the Doppler curve, swelling as
 * the car is level with the camera and panned from left to right. */
export function enginePass(ctx: BaseAudioContext, dest: AudioNode, when: number, v: PassVoice, sample?: AudioBuffer): void {
  const end = when + v.duration;
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(v.panFrom, when);
  pan.pan.linearRampToValueAtTime(v.panTo, end);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, when);
  out.gain.setValueCurveAtTime(curve(CURVE_POINTS, (u) => v.gain * swellAt(u)), when, v.duration);
  out.connect(pan).connect(dest);

  if (sample) { // a pack's own sound: its pitch bends with the same curve
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.setValueCurveAtTime(curve(CURVE_POINTS, dopplerAt), when, v.duration);
    src.connect(out);
    src.start(when);
    src.stop(end + 0.05);
    return;
  }

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, when);
  lp.frequency.setValueCurveAtTime(curve(CURVE_POINTS, (u) => 700 + 2600 * swellAt(u)), when, v.duration);
  lp.Q.value = 0.9;
  lp.connect(out);
  for (const [type, mult, level] of [["sawtooth", 1, 0.5], ["sawtooth", 2.01, 0.28], ["triangle", 0.5, 0.55]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueCurveAtTime(curve(CURVE_POINTS, (u) => v.baseHz * mult * dopplerAt(u)), when, v.duration);
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(lp);
    o.start(when);
    o.stop(end + 0.05);
  }
  const wind = noiseSource(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  const wg = ctx.createGain();
  wg.gain.value = 0.16;
  wind.connect(bp).connect(wg).connect(out);
  wind.start(when);
  wind.stop(end + 0.05);
}

/** A burst of wheel guns: a buzzing square wave chopped at about 40 Hz, with a click of noise on each. */
export function pitGun(ctx: BaseAudioContext, out: AudioNode, when: number, sample?: AudioBuffer, n = 4): void {
  const dest = ctx.createGain(); // four guns overlap, so the burst as a whole is trimmed to leave headroom
  dest.gain.value = 0.72;
  dest.connect(out);
  for (const dt of gunTimes(n)) {
    const t = when + dt;
    const len = 0.34;
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = 0.95 + (dt * 2) % 0.12;
      src.connect(dest);
      src.start(t);
      continue;
    }
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(250 + dt * 400, t);
    const am = ctx.createGain();
    am.gain.value = 0.3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.15, t + 0.012);
    env.gain.setValueAtTime(0.15, t + len - 0.06);
    env.gain.linearRampToValueAtTime(0, t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    o.connect(am).connect(lp).connect(env).connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + len + 0.02);
    lfo.stop(t + len + 0.02);
    const click = noiseSource(ctx, false);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.08, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2400;
    click.connect(hp).connect(cg).connect(dest);
    click.start(t);
    click.stop(t + 0.06);
  }
}

/** The radio: a beep as the channel opens or closes, with a short crackle of band-passed noise. */
export function radioBlip(ctx: BaseAudioContext, dest: AudioNode, when: number, open: boolean, sample?: AudioBuffer): void {
  if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.connect(dest);
    src.start(when);
    return;
  }
  const f0 = open ? 1250 : 980;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, when);
  o.frequency.setValueAtTime(f0 * 1.25, when + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(0.28, when + 0.01);
  g.gain.setValueAtTime(0.28, when + 0.12);
  g.gain.linearRampToValueAtTime(0, when + 0.16);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.18);
  const n = noiseSource(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 1.4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.16, when + 0.14);
  ng.gain.exponentialRampToValueAtTime(0.001, when + (open ? 0.32 : 0.22));
  n.connect(bp).connect(ng).connect(dest);
  n.start(when + 0.14);
  n.stop(when + 0.34);
}

/** A tool dropped somewhere in the garage: two metal partials decaying. */
export function clank(ctx: BaseAudioContext, dest: AudioNode, when: number, pitch = 1): void {
  for (const [hz, level, decay] of [[1870, 0.2, 0.28], [3140, 0.12, 0.16], [760, 0.1, 0.4]] as const) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hz * pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + decay);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + decay + 0.02);
  }
}

/** The garage's background: a low rumble and a band of hiss, looping. Returns the nodes to stop it. */
export function garageBed(ctx: BaseAudioContext, dest: AudioNode, sample?: AudioBuffer): { stop: () => void } {
  const stops: (() => void)[] = [];
  if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.loop = true;
    src.connect(dest);
    src.start();
    return { stop: () => src.stop() };
  }
  const rumble = noiseSource(ctx, true);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  const rg = ctx.createGain();
  rg.gain.value = 0.55;
  rumble.connect(lp).connect(rg).connect(dest);
  rumble.start();
  stops.push(() => rumble.stop());
  const hiss = noiseSource(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  bp.Q.value = 0.5;
  const hg = ctx.createGain();
  hg.gain.value = 0.025;
  hiss.connect(bp).connect(hg).connect(dest);
  hiss.start();
  stops.push(() => hiss.stop());
  return { stop: () => stops.forEach((s) => s()) };
}

/** One start-light beep: a short clean tone, the sound every start gantry has had on television and in games since. */
export function startBeep(ctx: BaseAudioContext, out: AudioNode, when: number, hz = 880): void {
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = hz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.28, when + 0.01);
  env.gain.setValueAtTime(0.28, when + 0.17);
  env.gain.linearRampToValueAtTime(0, when + 0.22);
  o.connect(env).connect(out);
  o.start(when);
  o.stop(when + 0.25);
}

/** Lights out: a field of engines going to full revs at once. Detuned saws climbing together under a band of noise, then falling away. */
export function lightsOutRoar(ctx: BaseAudioContext, out: AudioNode, when: number, length = 2.4): void {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, when);
  bus.gain.linearRampToValueAtTime(0.5, when + 0.12);
  bus.gain.setValueAtTime(0.5, when + length * 0.55);
  bus.gain.linearRampToValueAtTime(0, when + length);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(700, when);
  lp.frequency.linearRampToValueAtTime(2600, when + length * 0.5);
  lp.connect(bus).connect(out);
  [0.97, 1, 1.03, 1.5].forEach((detune, i) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(110 * detune, when);
    o.frequency.exponentialRampToValueAtTime(420 * detune, when + length * 0.5);
    o.frequency.linearRampToValueAtTime(330 * detune, when + length);
    const g = ctx.createGain();
    g.gain.value = i === 3 ? 0.08 : 0.16;
    o.connect(g).connect(lp);
    o.start(when);
    o.stop(when + length + 0.05);
  });
  const n = noiseSource(ctx, false);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.value = 0.12;
  n.connect(bp).connect(ng).connect(bus);
  n.start(when);
  n.stop(when + length + 0.05);
}
