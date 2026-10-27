// End-to-end check of the team radio panel against a dev server on your own port: asks a driver about tyres, waits for the answer,
// accepts a request if one comes, and prints the transcript. Usage: node scripts/radio.mjs <base-url> <out.png>
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startRace } from "./flow.mjs";

const [base, out] = process.argv.slice(2);
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
await startRace(page, { speed: 5 });
await page.waitForSelector("[role=tab]");
await page.waitForTimeout(6000);
await page.click("[role=tab]:has-text('Team radio')");
await page.locator(".radio-ask button:has-text('Tyres')").first().click();
await page.waitForTimeout(500);
const immediate = await page.locator(".radio-log li").allTextContents();
await page.waitForTimeout(9000);
const later = await page.locator(".radio-log li").allTextContents();
const cards = await page.locator(".radio-request").count();
let accepted = null;
if (cards) {
  accepted = await page.locator(".radio-request p").first().innerText();
  await page.locator(".radio-request button:has-text('Accept')").first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
const audio = await page.evaluate(() => window.__undercutAudio ?? null);
console.log(JSON.stringify({ audio, immediate, laterCount: later.length, newest: later.slice(0, 4), cards, accepted, cardsAfter: await page.locator(".radio-request").count(), errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
