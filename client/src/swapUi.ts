/** The rule for offering a team-order swap (docs: the backend's `SwapPositions`): only while racing, both own cars running, the second
 * directly behind the first and within the window (3 s), no swap already pending, and not in the last two laps. The server refuses anything else, so this only decides what
 * the control shows; it mirrors the rule, it does not replace it. */
import type { CarRow, Corner, View } from "./types";

export const MAX_SWAP_GAP_S = 3;
/** The server refuses a swap when this few laps or fewer are left for the leading car. */
export const SWAP_LAST_LAPS = 2;

/** What makes a team order possible, for the control to say when it is not. */
export const SWAP_RULE = (windowS: number) => `Needs your cars one behind the other within ${windowS} s, racing under green, and more than ${SWAP_LAST_LAPS} laps to go.`;

export type SwapOffer =
  | { ok: true; lead: string; rear: string; gap: number }
  | { ok: false; reason: string; lead?: string; rear?: string };

export function swapOffer(view: View, humanCars: string[], windowS = MAX_SWAP_GAP_S): SwapOffer {
  if (humanCars.length < 2) return { ok: false, reason: "You control one car." };
  const cars = humanCars.map((id) => view.cars.find((c) => c.id === id)).filter((c) => !!c);
  if (cars.length < 2) return { ok: false, reason: "Both cars are needed." };
  const [lead, rear] = [...cars].sort((a, b) => a!.position - b!.position) as [NonNullable<(typeof cars)[0]>, NonNullable<(typeof cars)[0]>];
  const pair = { lead: lead.id, rear: rear.id };
  if (view.session !== "RACING") return { ok: false, reason: "Not under the safety car, VSC, a red flag or on the grid.", ...pair };
  if (lead.status !== "RUNNING" || rear.status !== "RUNNING") return { ok: false, reason: "Both cars must be running.", ...pair };
  if (view.own[lead.id]?.swap || view.own[rear.id]?.swap) return { ok: false, reason: "A swap is already pending.", ...pair };
  if (rear.position !== lead.position + 1) return { ok: false, reason: "Another car is between yours.", ...pair };
  const gap = rear.interval_s;
  if (gap === null || gap > windowS) return { ok: false, reason: `Gap is over ${windowS} s.`, ...pair };
  if (view.total_laps - lead.lap <= SWAP_LAST_LAPS) return { ok: false, reason: "Too late in the race.", ...pair };
  return { ok: true, ...pair, gap };
}

/** Where a swap can be anchored: as soon as possible, or before or after a turn. */
export const anchorKey = (anchor: "asap" | "before" | "after", turn?: number) => (anchor === "asap" ? "asap" : `${anchor}:${turn}`);

export function parseAnchor(key: string): { anchor: "asap" | "before" | "after"; turn?: number } {
  if (key === "asap") return { anchor: "asap" };
  const [anchor, turn] = key.split(":");
  return { anchor: anchor as "before" | "after", turn: Number(turn) };
}

export function anchorOptions(corners: Corner[] | undefined): { key: string; label: string }[] {
  const out = [{ key: "asap", label: "As soon as possible" }];
  for (const c of [...(corners ?? [])].sort((a, b) => a.n - b.n)) {
    out.push({ key: anchorKey("before", c.n), label: `Before turn ${c.n}` }, { key: anchorKey("after", c.n), label: `After turn ${c.n}` });
  }
  return out;
}

export const swapStatus = (s: { anchor: string; turn: number | null; phase: string }): string => {
  const when = s.anchor === "asap" ? "as soon as possible" : `${s.anchor} turn ${s.turn}`;
  const phase = s.phase === "asked" ? "asked the driver" : s.phase === "waiting" ? "waiting for the place" : "lifting to let the car by";
  return `Swap ${when}: ${phase}`;
};

/** The cars a "box opposite" can name for `id`: running cars of other teams on the same lap that are ahead, nearest first (by place, so
 * none between the two is skipped), with how far ahead each is. At most `limit`. */
export function rivalsAhead(view: View, id: string, limit = 4): { c: CarRow; gap: number }[] {
  const me = view.cars.find((c) => c.id === id);
  if (!me || me.gap_to_leader_s == null) return [];
  return view.cars
    .filter((c) => c.status === "RUNNING" && c.position < me.position && c.team !== me.team && c.gap_to_leader_s != null && c.laps_down === me.laps_down)
    .sort((a, b) => b.position - a.position)
    .map((c) => ({ c, gap: Math.max(me.gap_to_leader_s! - c.gap_to_leader_s!, 0) }))
    .slice(0, limit);
}
