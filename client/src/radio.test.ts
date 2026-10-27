import { describe, expect, it } from "vitest";
import { checkEvent } from "./contract/contract";
import { initialState, reduce } from "./state";
import type { GameEvent, ServerMessage } from "./types";

const line = (id: number, over: Record<string, unknown> = {}): GameEvent => ({
  tick: id * 10,
  type: "radio",
  payload: { id, car: "BRA", from: "driver", speaker: "Brackett", message: `line ${id}`, topic: "tyres", reply_to: null, request: null, ...over },
});
const send = (events: GameEvent[]) => events.reduce((s, event) => reduce(s, { type: "event", event } as ServerMessage), initialState);
const request = { kind: "box", label: "Box now for hards", expires: 140 };

describe("team radio in the race state", () => {
  it("keeps a transcript in order, outside the race control list", () => {
    const s = send([line(1), line(2, { from: "engineer", speaker: "Race engineer", reply_to: 1 })]);
    expect(s.radio.map((r) => r.id)).toEqual([1, 2]);
    expect(s.radio[1]).toMatchObject({ from: "engineer", reply_to: 1, tick: 20 });
    expect(s.messages).toEqual([]);
  });

  it("holds a driver's request until it is closed, then drops it", () => {
    let s = send([line(1), line(2, { request })]);
    expect(s.requests.map((r) => r.id)).toEqual([2]);
    s = reduce(s, { type: "event", event: { tick: 99, type: "radio_request_closed", payload: { id: 2, car: "BRA", reason: "accepted" } } } as ServerMessage);
    expect(s.requests).toEqual([]);
    expect(s.radio).toHaveLength(2);
  });

  it("does not list a line twice if it arrives twice (a snapshot after a reconnect)", () => {
    const s = send([line(1), line(1)]);
    expect(s.radio).toHaveLength(1);
  });

  it("rebuilds from a snapshot's history, and caps the transcript", () => {
    const history = Array.from({ length: 230 }, (_, i) => line(i + 1));
    const s = reduce(initialState, { type: "snapshot", info: { id: "r", circuit: "x", total_laps: 1, human_team: "T", human_cars: ["BRA"] }, view: { cars: [], own: {}, time_s: 0, session: "RACING" } as never, clock: { time_s: 0, tick: 0, speed: 1, paused: false, pause_allowed: true, session: "RACING" }, history } as ServerMessage);
    expect(s.radio).toHaveLength(200);
    expect(s.radio[199].id).toBe(230);
  });
});

describe("radio events and the contract", () => {
  it("accepts the server's radio and request-closed events, and flags a radio field that is not listed", () => {
    expect(checkEvent(line(1, { request }))).toEqual([]);
    expect(checkEvent({ tick: 1, type: "radio_request_closed", payload: { id: 2, car: "BRA", reason: "expired" } })).toEqual([]);
    expect(checkEvent(line(1, { mood: "angry" })).join()).toContain("event[radio].payload.mood: new field");
  });
});
