export const gap = (s: number | null, leader = false, lapsDown = 0) =>
  leader ? "Leader" : lapsDown > 0 ? `+${lapsDown} lap${lapsDown > 1 ? "s" : ""}` : s == null ? "" : `+${s.toFixed(1)}`;

export function lapTime(s: number | null): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

export function clockText(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** "1 lap", "2 laps": a count with its noun, regular plurals only. */
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
