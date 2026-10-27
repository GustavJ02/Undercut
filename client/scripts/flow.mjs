// The way into a single-player race, shared by the end-to-end scripts: landing page, Singleplayer, the setup steps (team, circuit,
// race), the grid, and, with `lightsOut`, the start. The setup is a stepped wizard, so the scripts walk it like a player does.
//   await startRace(page, { circuit: "austin", speed: 10, short: false, lightsOut: true })
export async function startRace(page, { circuit, speed = 10, short = false, lightsOut = true } = {}) {
  if (await page.waitForSelector("text=Enter the pit wall", { timeout: 4000 }).catch(() => null)) {
    await page.waitForTimeout(800);
    await page.click("text=Enter the pit wall");
  }
  await page.click(".mode-card >> nth=0"); // Singleplayer
  await page.click("button.primary:has-text('Next')"); // team -> circuit
  if (circuit) await page.click(`[aria-label=Circuits] >> text=${circuit.replace(/_/g, " ")}`);
  await page.click("button.primary:has-text('Next')"); // circuit -> race
  if (short) await page.click("text=Short race");
  await page.click(`[aria-label=Speed] >> text=${speed}x`);
  await page.click("text=Go to the grid");
  await page.waitForSelector("text=Lights out");
  if (lightsOut) {
    await page.waitForTimeout(4200);
    await page.click("text=Lights out");
    await page.waitForSelector(".race", { state: "attached" });
  }
}
