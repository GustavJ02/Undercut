// Plays the real game in headless Chromium against a dev server and takes screenshots; for milestone checks.
//   node scripts/play.mjs <base-url> <out-prefix> [--circuit austin] [--speed 10] [--scene 1] [--wait 20000] [--w 1920] [--h 1080] [--no-webgl] [--reduced] [--skipintro]
// Saves <prefix>-grid (the briefing) and <prefix>.png (the race). The way in is shared with the other scripts: scripts/flow.mjs.
// The page's /api and /ws must reach a server you started on your own port (vite's UNDERCUT_API); this never starts or stops one.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { join } from "node:path";
import { startRace } from "./flow.mjs";

const args = process.argv.slice(2);
const [base, prefix] = args;
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const w = Number(opt("w", 1920)), h = Number(opt("h", 1080));
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const noGl = args.includes("--no-webgl");
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: args.includes("--reduced") ? "reduce" : "no-preference" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(noGl ? `${base}${base.includes("?") ? "&" : "?"}nogl` : base); // `?nogl` is a dev-only switch that makes Pixi fail to start
if (args.includes("--skipintro")) await page.evaluate(() => localStorage.setItem("undercut.settings", JSON.stringify({ skipIntro: true }))).then(() => page.reload());
const circuit = opt("circuit", "austin");
await startRace(page, { circuit, speed: Number(opt("speed", "10")), lightsOut: false });
await page.screenshot({ path: `${prefix}-grid.png` });
await page.waitForTimeout(Number(opt("grid-wait", 4200)));
await page.click("text=Lights out");
await page.waitForSelector(".race", { state: "attached" });
if (opt("scene", "1") === "1" && (await page.$("button:has-text('Scene')")) && !(await page.$("button.chosen:has-text('Scene')"))) await page.click("button:has-text('Scene')"); // plain layout only
await page.waitForTimeout(Number(opt("wait", 20000)));
await page.screenshot({ path: `${prefix}.png` });
const stats = await page.evaluate(() => ({ scene: window.__undercutScene ?? null, stage: window.__undercutStage ?? null, layout: document.querySelector(".stage") ? "pitwall" : "plain" }));
console.log(JSON.stringify({ stats, loadavg1: +loadavg()[0].toFixed(2), viewport: `${w}x${h}`, errors }, null, 1));
await browser.close();
if (errors.some((e) => e.startsWith("pageerror"))) process.exit(1); // a script error in the page is a failure, whatever the screenshot looks like
