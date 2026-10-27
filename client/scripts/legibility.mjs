// Legibility check for the pit-wall stage (docs/presentation-design.md section 9): at each window size, every tower row must sit
// inside its monitor and the text of the monitors must be at least MIN_PX on screen once the stage is scaled to the window.
//   node scripts/legibility.mjs <base-url> <out-prefix>      (uses /?replay&screen=pitwall, no server needed)
// Body text must be at least MIN_PX; the one-letter tyre badges, which are also colour coded, at least MIN_BADGE_PX. Exits 1 when a check fails. Sizes: 1920x1080, 2560x1440, 1536x864 (the smallest the stage is used at is 1500x840).
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [base, prefix] = process.argv.slice(2);
const MIN_PX = 11;
const MIN_BADGE_PX = 9;
const root = join(homedir(), ".cache", "ms-playwright");
const exe = process.env.PLAYWRIGHT_CHROME ?? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, "chrome-linux64", "chrome")).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=gl", "--ignore-gpu-blocklist"] });
let failed = false;
for (const [w, h, reduced] of [[1920, 1080, false], [2560, 1440, false], [1536, 864, false], [1920, 1080, true]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.goto(`${base}/?replay&screen=pitwall&speed=10`);
  await page.waitForSelector(".monitor-tower tbody tr", { timeout: 15000 });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(([MIN_PX, MIN_BADGE_PX]) => {
    const out = { rows: 0, outside: 0, minText: 99, small: [], monitors: {} };
    for (const name of ["tower", "map", "ops"]) {
      const screen = document.querySelector(`.monitor-${name} .monitor-screen`);
      const sr = screen.getBoundingClientRect();
      const scale = sr.width / screen.offsetWidth; // the stage's scale, as drawn
      let min = 99;
      const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (el.closest("canvas, svg, .scene")) continue;
        const px = parseFloat(getComputedStyle(el).fontSize) * scale;
        const need = el.closest(".tyre") ? MIN_BADGE_PX : MIN_PX;
        if (px - need + MIN_PX < min) min = px - need + MIN_PX; // margin against the threshold that applies, shown as an equivalent body-text size
        if (px < need) out.small.push(`${name}: ${px.toFixed(1)}px "${n.textContent.trim().slice(0, 24)}"`);
      }
      out.monitors[name] = { scale: +scale.toFixed(3), minTextPx: +min.toFixed(1) };
      out.minText = Math.min(out.minText, min);
      if (name === "tower") {
        const rows = [...screen.querySelectorAll("tbody tr")];
        out.rows = rows.length;
        out.outside = rows.filter((tr) => { const b = tr.getBoundingClientRect(); return b.top < sr.top - 0.5 || b.bottom > sr.bottom + 0.5 || b.left < sr.left - 0.5 || b.right > sr.right + 0.5; }).length;
        out.towerScrolls = screen.scrollHeight > screen.clientHeight + 1;
      }
    }
    return out;
  }, [MIN_PX, MIN_BADGE_PX]);
  const ok = r.rows === 22 && r.outside === 0 && !r.towerScrolls && r.minText >= MIN_PX;
  if (!ok) failed = true;
  console.log(`${w}x${h}${reduced ? " reduced-motion" : ""}: ${ok ? "PASS" : "FAIL"} rows=${r.rows} outside=${r.outside} towerScrolls=${r.towerScrolls} minText=${r.minText.toFixed(1)}px`, JSON.stringify(r.monitors), r.small.slice(0, 4));
  await page.screenshot({ path: `${prefix}-${w}x${h}${reduced ? "-reduced" : ""}.png` });
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
