/** How to destroy a Pixi Application when other applications share the page (the stage and the monitor's track scene do).
 *
 * `app.destroy(true, ...)` passes `true` on to the renderer, and a renderer destroyed with `true` also releases Pixi's global
 * pools (batches, textures, canvases), which every other application on the page is still using: the survivors then crash in their
 * next frame with "Cannot read properties of null". An options object without `releaseGlobalResources` removes the canvas and
 * leaves the pools alone. Never pass `texture: true` either, for the same reason.
 */
export const DESTROY = [{ removeView: true }, { children: true }] as const;

/** Development seam for testing the fallback to the plain layout: `?nogl` makes every Pixi application fail to start, as it would
 * on a machine without WebGL. (Switching WebGL off in headless Chromium does not work: it falls back to software GL.) */
export const SIMULATE_NO_WEBGL = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("nogl");
