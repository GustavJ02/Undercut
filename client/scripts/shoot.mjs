// Screenshot and frame-time probe for the presentation layer (docs/presentation-design.md section 9).
//   node scripts/shoot.mjs <url> <out.png> [--w 1920] [--h 1080] [--wait 4000] [--frames 3] [--clip x,y,w,h]
// Uses playwright-core with a locally cached Chromium (PLAYWRIGHT_CHROME overrides the path). Prints the WebGL renderer, the
// scene's own frame stats, the real requestAnimationFrame rate over one second and the machine load, because a frame-rate
// number means nothing without the load it was taken under.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir, loadavg, cpus } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const clipArg = args.includes("--clip") ? args[args.indexOf("--clip") + 1].split(",").map(Number) : null;
const [url, out] = args;
const opt = (k, d) => (args.includes(`--${k}`) ? Number(args[args.indexOf(`--${k}`) + 1]) : d);
const dpr = opt("dpr", 1), w = opt("w", 1920), h = opt("h", 1080), wait = opt("wait", 4000), frames = opt("frames", 1);

function chromePath() {
  if (process.env.PLAYWRIGHT_CHROME) return process.env.PLAYWRIGHT_CHROME;
  const root = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(root, d, "chrome-linux64", "chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("no Chromium found; set PLAYWRIGHT_CHROME");
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--use-angle=gl", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const errors = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(wait);
const load0 = loadavg()[0];
const probe = await page.evaluate(async () => {
  const c = document.createElement("canvas").getContext("webgl2");
  const ext = c?.getExtension("WEBGL_debug_renderer_info");
  let n = 0;
  const t0 = performance.now();
  await new Promise((res) => { const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
  return { renderer: ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown", raf: n, scene: window.__undercutScene ?? null };
});
for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: frames > 1 ? out.replace(/\.png$/, `-${i}.png`) : out, ...(clipArg ? { clip: { x: clipArg[0], y: clipArg[1], width: clipArg[2], height: clipArg[3] } } : {}) });
  if (i < frames - 1) await page.waitForTimeout(400);
}
console.log(JSON.stringify({ ...probe, viewport: `${w}x${h}`, loadavg1: +load0.toFixed(2), cores: cpus().length, errors }, null, 1));
await browser.close();
