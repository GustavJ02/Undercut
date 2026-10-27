// Checks the synthesised sounds without speakers: renders each one offline in the browser and measures it (level, no NaN, pitch bend,
// decay, timing). Usage: node scripts/audiocheck.mjs <dev-server-url>      Exits 1 when a check fails.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [base] = process.argv.slice(2);
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/?replay`);
const result = await page.evaluate(async () => {
  const synth = await import("/src/audio/synth.ts");
  const voices = await import("/src/audio/voices.ts");
  const SR = 44100;
  const render = async (seconds, build) => {
    const ctx = new OfflineAudioContext(2, SR * seconds, SR);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    build(ctx, out);
    const buf = await ctx.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  };
  const peak = (d, a = 0, b = d.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(d[i])); return m; };
  const rms = (d, a = 0, b = d.length) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(b - a, 1)); };
  const finite = (d) => { for (let i = 0; i < d.length; i += 7) if (!Number.isFinite(d[i])) return false; return true; };
  // the strongest repetition rate between 40 and 400 Hz, by autocorrelation over a few windows (noise and harmonics do not fool it)
  const pitch = (d, a, b) => {
    const win = 4096, found = [];
    for (let start = a; start + win + 1200 < b; start += 2048) {
      let best = 0, bestLag = 0;
      for (let lag = Math.floor(SR / 400); lag <= Math.floor(SR / 40); lag++) { let c = 0; for (let i = 0; i < win; i += 2) c += d[start + i] * d[start + i + lag]; if (c > best) { best = c; bestLag = lag; } }
      if (bestLag) found.push(SR / bestLag);
    }
    return found.length ? found.reduce((x, y) => x + y, 0) / found.length : 0;
  };
  const out = {};

  // a car passing: 2 s, loud in the middle, quiet at the ends, pitch falling, panned left to right
  const v = voices.passVoice("BRA", 1280);
  const [L, R] = await render(3, (ctx, o) => synth.enginePass(ctx, o, 0.2, v));
  const n = v.duration * SR, s0 = 0.2 * SR;
  out.pass = {
    duration: v.duration, peak: peak(L), finite: finite(L) && finite(R),
    midToEdge: rms(L, s0 + n * 0.42, s0 + n * 0.58) / Math.max(rms(L, s0, s0 + n * 0.06), 1e-6),
    pitchEarly: pitch(L, s0 + n * 0.08, s0 + n * 0.36), pitchLate: pitch(L, s0 + n * 0.64, s0 + n * 0.92),
    panLeftFirst: rms(L, s0 + n * 0.1, s0 + n * 0.3) / Math.max(rms(R, s0 + n * 0.1, s0 + n * 0.3), 1e-6),
    panRightLast: rms(R, s0 + n * 0.7, s0 + n * 0.9) / Math.max(rms(L, s0 + n * 0.7, s0 + n * 0.9), 1e-6),
    silentAfter: rms(L, Math.floor((0.2 + v.duration + 0.15) * SR), 3 * SR),
  };

  // four wheel guns
  const [G] = await render(1.5, (ctx, o) => synth.pitGun(ctx, o, 0.1));
  const bursts = [];
  for (const t of voices.gunTimes()) bursts.push(rms(G, Math.floor((0.1 + t + 0.03) * SR), Math.floor((0.1 + t + 0.15) * SR)));
  out.gun = { peak: peak(G), finite: finite(G), burstRms: bursts, quietBefore: rms(G, 0, Math.floor(0.09 * SR)), quietAfter: rms(G, Math.floor(1.0 * SR), 1.5 * SR) };

  // radio blips open and close, and a clank decaying
  const [Ro] = await render(0.6, (ctx, o) => synth.radioBlip(ctx, o, 0.05, true));
  const [Rc] = await render(0.6, (ctx, o) => synth.radioBlip(ctx, o, 0.05, false));
  out.radio = { openPeak: peak(Ro), closePeak: peak(Rc), finite: finite(Ro) && finite(Rc), tail: rms(Ro, Math.floor(0.45 * SR), 0.6 * SR) };
  const [C] = await render(1, (ctx, o) => synth.clank(ctx, o, 0.05));
  out.clank = { peak: peak(C), early: rms(C, Math.floor(0.06 * SR), Math.floor(0.16 * SR)), late: rms(C, Math.floor(0.6 * SR), SR), finite: finite(C) };

  // the garage bed: audible but quiet, steady, no NaN
  const [B] = await render(2, (ctx, o) => synth.garageBed(ctx, o));
  out.bed = { rms: rms(B), peak: peak(B), finite: finite(B), steady: rms(B, 0, SR) / Math.max(rms(B, SR, 2 * SR), 1e-6) };
  return out;
});
await browser.close();

const checks = [
  ["pass: audible, not clipping", result.pass.peak > 0.05 && result.pass.peak < 0.85],
  ["pass: finite samples", result.pass.finite],
  ["pass: much louder in the middle than at the ends", result.pass.midToEdge > 3],
  ["pass: pitch falls as it goes by (Doppler)", result.pass.pitchEarly > result.pass.pitchLate * 1.15],
  ["pass: starts on the left and ends on the right", result.pass.panLeftFirst > 1.5 && result.pass.panRightLast > 1.5],
  ["pass: silent once it has gone", result.pass.silentAfter < 0.001],
  ["gun: audible, not clipping, finite", result.gun.peak > 0.05 && result.gun.peak < 0.85 && result.gun.finite],
  ["gun: four bursts, silence before and after", result.gun.burstRms.every((r) => r > 0.02) && result.gun.quietBefore < 0.002 && result.gun.quietAfter < 0.002],
  ["radio: both blips audible, finite, and fade out", result.radio.openPeak > 0.05 && result.radio.closePeak > 0.05 && result.radio.finite && result.radio.tail < 0.005],
  ["clank: audible and decays", result.clank.peak > 0.03 && result.clank.finite && result.clank.late < result.clank.early * 0.2],
  ["garage bed: quiet but present, steady", result.bed.rms > 0.005 && result.bed.peak < 0.6 && result.bed.finite && result.bed.steady > 0.7 && result.bed.steady < 1.4],
];
console.log(JSON.stringify(result, null, 1));
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (errors.length) { console.log("page errors:", errors); failed = true; }
process.exit(failed ? 1 : 0);
