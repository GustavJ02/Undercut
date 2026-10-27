// End-to-end check of the team-order control against a dev server on your own port: plays until a swap is on offer, asks for one
// before a turn, and prints what the radio and race-control list say. Usage: node scripts/swap.mjs <base-url> <out.png>
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startRace } from "./flow.mjs";

const [base, out] = process.argv.slice(2);
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
await startRace(page, { speed: 5 });
const button = page.locator(".swap button:has-text('Swap')");
let offered = false;
for (let i = 0; i < 120 && !offered; i++) {
  offered = await button.isVisible().catch(() => false);
  if (!offered) await page.waitForTimeout(1000);
}
let result = { offered };
if (offered) {
  const options = await page.locator(".swap select option").allTextContents();
  await page.selectOption(".swap select", { label: options[5] ?? options[1] });
  await page.screenshot({ path: out.replace(/\.png$/, "-offer.png") });
  await button.click();
  await page.waitForTimeout(6000);
  const messages = await page.locator(".messages li").allTextContents();
  const panel = await page.locator(".swap").innerText();
  result = { offered, chose: options[5] ?? options[1], optionCount: options.length, panel, messages: messages.filter((m) => /swap|order|let|Box|radio/i.test(m)).slice(0, 6) };
}
await page.screenshot({ path: out });
console.log(JSON.stringify({ ...result, errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
