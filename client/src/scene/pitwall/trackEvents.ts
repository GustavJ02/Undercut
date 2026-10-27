/** What makes the scenery open up again during a race: the things worth looking up at the track for. Pure, so it is tested as data. */
import type { View } from "../../types";

export const EVENT_OPEN_MS = 6000;

export type TrackEvent = "stop" | "overtake" | "safety";

/** The event between two views, if any: a car of ours entering the pits, one of ours changing position, or the race going under a
 * safety car, VSC or red flag. */
export function trackEvent(prev: View | null, next: View, own: string[]): TrackEvent | null {
  if (!prev || prev.session === "GRID") return null;
  if (next.session !== prev.session && ["SC", "VSC", "RED"].includes(next.session)) return "safety";
  for (const id of own) {
    const a = prev.cars.find((c) => c.id === id), b = next.cars.find((c) => c.id === id);
    if (!a || !b) continue;
    if (b.status === "IN_PIT" && a.status !== "IN_PIT") return "stop";
    if (b.position !== a.position && b.status !== "IN_PIT" && a.status !== "IN_PIT") return "overtake";
  }
  return null;
}

/** The caption shown over the collapsed scenery band for an event. */
export function eventNote(event: TrackEvent, session: string): string {
  if (event === "stop") return "Pit stop";
  if (event === "overtake") return "Position change";
  return session === "VSC" ? "Virtual safety car" : session === "RED" ? "Red flag" : "Safety car";
}
