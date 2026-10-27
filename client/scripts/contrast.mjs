// Contrast audit: every visible text on each screen of a single-player race against its effective background (WCAG AA: 4.5:1, 3:1 for
// large text). Walks the real flow, so it needs the game server and Vite running.
//   node scripts/contrast.mjs <base-url> [--finish]      prints the failing text per screen; exits 1 when any fails
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const root = join(homedir(), ".cache", "ms-playwright");
const exe = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
const audit = () => page.evaluate(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } } let base = { r: 5, g: 7, b: 10, a: 1 }; for (const c of stack.reverse()) base = over(c, base); return base; };
  const out = new Map();
  const check = (el, text) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || el.closest(":disabled")) return; // disabled controls are exempt
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
    let seen = 1; for (let e = el; e; e = e.parentElement) seen *= +getComputedStyle(e).opacity; if (seen < 0.05) return; // faded out: not shown
    const isSvg = el instanceof SVGElement;
    let fg = parse(isSvg ? cs.fill : cs.color); if (!fg) return;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const bg = bgOf(el); fg = over({ ...fg, a: fg.a * op }, bg);
    const [a, bb] = [lum(fg), lum(bg)].sort((x, y) => y - x); const ratio = (a + 0.05) / (bb + 0.05);
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = px >= 24 || (px >= 18.66 && bold);
    if (ratio < (large ? 3 : 4.5)) { const key = (el.className?.baseVal ?? el.className) + "|" + cs.color + "|" + ratio.toFixed(2); if (!out.has(key)) out.set(key, { cls: (el.className?.baseVal ?? el.className) || el.tagName, ratio: +ratio.toFixed(2), text: text.slice(0, 40), fg: isSvg ? cs.fill : cs.color }); }
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.textContent.trim()) check(n.parentElement, n.textContent.trim()); }
  return [...out.values()];
});
const report = async (name) => { const r = await audit(); if (r.length) failed = true; console.log("== " + name + ": " + r.length); for (const x of r) console.log("  ", x.ratio, x.cls, JSON.stringify(x.text), x.fg); };
const base = process.argv[2] ?? "http://localhost:5199";
let failed = false;
await page.goto(base);
await page.evaluate(() => localStorage.setItem("undercut.settings", JSON.stringify({ skipIntro: true }))); await page.reload();
await page.click("text=Enter the pit wall").catch(() => {});
await page.click(".mode-card >> nth=0").catch(() => {});
await page.waitForTimeout(1200);
await report("setup team");
for (const n of ["circuit", "race"]) { await page.click("button.primary:has-text('Next')"); await page.waitForTimeout(500); await report("setup " + n); }
await page.click("text=Short race (15 laps)");
await page.click("[aria-label=Speed] >> text=10x");
await page.click("text=Go to the grid");
await page.waitForSelector("text=Lights out");
await page.waitForTimeout(3500);
await report("prerace");
await page.click("text=Lights out");
await page.waitForSelector(".race", { state: "attached" });
await page.waitForTimeout(45000);
await report("race pit tab");
await page.click("[role=tab]:has-text('Team radio')"); await page.waitForTimeout(400);
await report("race radio tab");
await page.keyboard.press("ArrowRight"); await page.waitForTimeout(2000);
await report("strategy");
if (process.argv.includes("--finish")) { // play the short race to the end: the results screen and the debrief
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector(".results-screen", { timeout: 420000 });
  await page.waitForTimeout(1000);
  await report("results");
  await page.click("button:has-text('Debrief')");
  await page.waitForSelector(".debrief .report, .debrief .error", { timeout: 240000 });
  await page.waitForTimeout(500);
  await report("debrief");
}
console.log(errs);
await b.close();
if (failed) process.exit(1);
