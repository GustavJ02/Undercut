/** The pit-wall stage in design space: a fixed 1920x1080 picture that is scaled to fit the window. Both the Pixi art (desk, monitor
 * bezels) and the DOM monitors are placed from these numbers, so they cannot drift apart. */
export const STAGE = { w: 1920, h: 1080 } as const;
export const HEADER_H = 56;
export const DESK_TOP = 410;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Monitors on the desk. `briefing` replaces the three while the grid is shown (tyre choice before lights out). */
export const MONITORS = {
  tower: { x: 32, y: 430, w: 640, h: 618 },
  map: { x: 692, y: 430, w: 536, h: 618 },
  ops: { x: 1248, y: 430, w: 640, h: 618 },
  briefing: { x: 160, y: 430, w: 1600, h: 618 },
  /** To the right of the wall, out of the picture until the camera looks over to it. */
  strategy: { x: 1960, y: 430, w: 1600, h: 618 },
} as const satisfies Record<string, Rect>;

export type MonitorName = keyof typeof MONITORS;

/** Space the bezel takes inside a monitor rect; the screen proper is the rect shrunk by this on every side. */
export const BEZEL = 8;

export const screenOf = (r: Rect): Rect => ({ x: r.x + BEZEL, y: r.y + BEZEL, w: r.w - 2 * BEZEL, h: r.h - 2 * BEZEL });

/** During a race the camera drops this far so the scenery shrinks to a thin band and the monitors grow by the same amount. */
export const DROP = 250;
