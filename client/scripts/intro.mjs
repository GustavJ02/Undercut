// Captures the move from the landing shot into the pit wall as a frame sequence and reports the frame times during the move.
//   node scripts/intro.mjs <url> <out-prefix> [--w 1920] [--h 1080] [--reduced 1] [--skip key|click]
// Needs a page whose stage starts a move on its own (`/?replay&screen=pitwall&intro=1`). Prints load average with the numbers.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const [url, prefix] = args;
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const w = Number(opt("w", 1920)), h = Number(opt("h", 1080));
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: opt("reduced", "0") === "1" ? "reduce" : "no-preference" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__undercutStage?.glReady, null, { timeout: 15000 });
await page.screenshot({ path: `${prefix}-0.png` });
const started = await page.waitForFunction(() => window.__undercutStage?.tweening, null, { timeout: 8000 }).then(() => true, () => false);
const shots = [];
let skipped = null;
if (started && opt("skip", "")) {
  await page.waitForTimeout(700);
  if (opt("skip", "") === "key") await page.keyboard.press("Space");
  else await page.click("button.stage-skip");
  await page.waitForTimeout(250);
  skipped = await page.evaluate(() => ({ tweening: window.__undercutStage.tweening, pose: window.__undercutStage.pose, progress: window.__undercutStage.progress }));
} else if (started) {
  for (let i = 1; i <= 7; i++) {
    await page.waitForTimeout(380);
    const st = await page.evaluate(() => ({ p: window.__undercutStage.progress, t: window.__undercutStage.tweening }));
    shots.push(st);
    await page.screenshot({ path: `${prefix}-${i}.png` });
    if (!st.t) break;
  }
  await page.waitForFunction(() => !window.__undercutStage.tweening, null, { timeout: 8000 });
}
await page.waitForTimeout(500);
const stage = await page.evaluate(() => window.__undercutStage);
console.log(JSON.stringify({ started, skipped, shots, stage, loadavg1: +loadavg()[0].toFixed(2), viewport: `${w}x${h}`, reducedMotion: opt("reduced", "0") === "1", errors }, null, 1));
await browser.close();
