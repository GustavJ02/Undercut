// End-to-end check that the engine makes sounds from a race: opens the scene replay, clicks once (unlocking audio) and reads the
// engine's counters. Usage: node scripts/audio-e2e.mjs <dev-server-url>      Exits 1 on failure.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [base] = process.argv.slice(2);
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/?replay&screen=pitwall&speed=1&nosc=1&laps=40&t0=173`);
await page.waitForSelector(".monitor-tower tbody tr");
await page.click(".monitor-tower"); // a user gesture unlocks the audio
await page.waitForTimeout(16000);
const stats = await page.evaluate(() => window.__undercutAudio);
await page.click("button:has-text('Sound')");
await page.click("input[type=checkbox]"); // mute
const mutedState = await page.evaluate(() => JSON.parse(localStorage.getItem("undercut.settings") ?? "{}").audio);
console.log(JSON.stringify({ stats, mutedState, errors }, null, 1));
await browser.close();
const ok = stats && stats.state === "running" && stats.passes >= 1 && stats.guns >= 1 && mutedState?.muted === true && !errors.length;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
