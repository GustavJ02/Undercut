/** Where a race lives in the address bar, so Back, a refresh and a copied link return to it (the results and the Debrief of a finished
 * race stay there for as long as the server keeps the room). The page is one screen; the address only says which race, and whether the
 * Debrief is open (`#debrief`). */
export const raceUrl = (roomId: string): string => `/?race=${encodeURIComponent(roomId)}`;

/** The race named by an address's query string, if it is shaped like a room id (a code or a generated id). */
export function raceFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("race");
  return id && /^[A-Za-z0-9_-]{4,16}$/.test(id) ? id : null;
}

export const DEBRIEF_HASH = "#debrief";
export const debriefFromHash = (hash: string): boolean => hash === DEBRIEF_HASH;
