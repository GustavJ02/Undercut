import type { Options, Player } from "./types";

export interface NewRaceRequest {
  team: string;
  circuit?: string;
  seed?: number;
  laps?: number;
  cars_controlled: number;
  speed: number;
  pause_allowed: boolean;
  weather: string;
  /** Chaos mode: factors on the fitted rates; the keys are the engine's, empty means realistic. */
  incident_multipliers?: Record<string, number>;
}

export async function getOptions(): Promise<Options> {
  const r = await fetch("/api/options");
  if (!r.ok) throw new Error(`options: ${r.status}`);
  return r.json();
}

export async function createRace(req: NewRaceRequest): Promise<{ id: string }> {
  const r = await fetch("/api/races", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  if (!r.ok) throw new Error(`could not create the race: ${(await r.json()).detail ?? r.status}`);
  return r.json();
}

export function socketUrl(roomId: string, team: string, seat?: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/${roomId}?team=${encodeURIComponent(team)}${seat ? `&seat=${encodeURIComponent(seat)}` : ""}`;
}

/** What a multiplayer create or join returns: the room's info with this player's team and secret seat token. */
export interface Seat {
  id: string;
  team: string;
  seat: string;
}

async function detail(r: Response): Promise<string> {
  try {
    return (await r.json()).detail ?? String(r.status);
  } catch {
    return String(r.status);
  }
}

export async function createGame(req: NewRaceRequest & { name?: string }): Promise<Seat> {
  const r = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  if (!r.ok) throw new Error(`could not create the game: ${await detail(r)}`);
  return r.json();
}

/** The game behind a code: its players, so the join screen can show which teams are free. Throws "no game" for an unknown code. */
export async function getGame(code: string): Promise<{ id: string; players: Player[]; circuit: string; total_laps: number; host: string | null }> {
  const r = await fetch(`/api/games/${encodeURIComponent(code.trim())}`);
  if (r.status === 404) throw new Error("There is no game with that code.");
  if (!r.ok) throw new Error(`could not find the game: ${await detail(r)}`);
  return r.json();
}

export async function joinGame(code: string, team: string, name: string): Promise<Seat> {
  const r = await fetch(`/api/games/${encodeURIComponent(code.trim())}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team, name }) });
  if (r.status === 409) throw new Error("That team is taken, or the race has already started.");
  if (!r.ok) throw new Error(`could not join: ${await detail(r)}`);
  return r.json();
}

import type { DebriefStatus } from "./types";

export async function startDebrief(roomId: string, futures = 24): Promise<void> {
  const r = await fetch(`/api/races/${roomId}/debrief?futures=${futures}`, { method: "POST" });
  if (!r.ok) throw new Error(`debrief: ${(await r.json()).detail ?? r.status}`);
}

export async function getDebrief(roomId: string): Promise<DebriefStatus> {
  const r = await fetch(`/api/races/${roomId}/debrief`);
  if (!r.ok) throw new Error(`debrief: ${(await r.json()).detail ?? r.status}`);
  return r.json();
}
