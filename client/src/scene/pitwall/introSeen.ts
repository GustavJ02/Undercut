/** Rooms whose move into the pit wall this browser tab has already shown, so a rebuilt screen or a reconnect never replays it. */
const KEY = "undercut.intro.seen";

type Store = Pick<Storage, "getItem" | "setItem">;

const sessionStore = (): Store | undefined => {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

const read = (s: Store | undefined): string[] => {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const seenBefore = (room: string, s: Store | undefined = sessionStore()): boolean => read(s).includes(room);

export function markSeen(room: string, s: Store | undefined = sessionStore()): void {
  try {
    s?.setItem(KEY, JSON.stringify([...new Set([...read(s), room])].slice(-50)));
  } catch {
    /* storage blocked: the worst case is one repeated move */
  }
}
