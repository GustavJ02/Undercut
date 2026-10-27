// Plays at speed until a driver asks for something (a request card), accepts or declines it, and checks the card goes away, the call is
// acknowledged and the page has no errors. Usage: node scripts/radio-accept.mjs <base-url> <out.png> [accept|decline] [max seconds]
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startRace } from "./flow.mjs";

const [base, out, answer = "accept", maxS = "300"] = process.argv.slice(2);
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
await startRace(page, { speed: 10 });
await page.waitForSelector(".monitor-tower");
let card = null;
for (let i = 0; i < Number(maxS) && !card; i++) {
  if (await page.locator(".radio-request").count()) card = await page.locator(".radio-request").first().innerText();
  else await page.waitForTimeout(1000);
}
const result = { card, answer, errors };
if (card) {
  const before = await page.locator(".messages li").count();
  await page.screenshot({ path: out.replace(/\.png$/, "-card.png") });
  await page.locator(`.radio-request button:has-text('${answer === "accept" ? "Accept" : "Decline"}')`).first().click();
  await page.waitForTimeout(2500);
  result.cardGone = (await page.locator(`.radio-request:has-text('${card.split("\n")[0].slice(0, 20).replace(/'/g, "")}')`).count()) === 0;
  result.messagesAfter = (await page.locator(".messages li").allTextContents()).slice(0, 5);
  result.newMessages = (await page.locator(".messages li").count()) - before;
  await page.click("[role=tab]:has-text('Team radio')");
  result.radioNewest = (await page.locator(".radio-log li").allTextContents()).slice(0, 3);
}
await page.screenshot({ path: out });
console.log(JSON.stringify(result, null, 1));
await browser.close();
process.exit(errors.length || !card ? 1 : 0);
