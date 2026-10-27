import { describe, expect, it } from "vitest";
import { describe as describeEvent } from "./state";
import { anchorOptions, parseAnchor, rivalsAhead, swapOffer, swapStatus } from "./swapUi";
import type { CarRow, View } from "./types";

const car = (id: string, position: number, over: Partial<CarRow> = {}): CarRow =>
  ({ id, team: "VMR", driver: id, position, lap: 3, lap_frac: 0.5, status: "RUNNING", compound: "MEDIUM", tyre_age: 3, stops: 0, compounds_used: [], sets_remaining: {}, last_lap_s: null, gap_to_leader_s: 0, interval_s: 1.2, laps_down: 0, ...over }) as CarRow;
const view = (cars: CarRow[], over: Partial<View> = {}): View =>
  ({ time_s: 100, session: "RACING", track_status: "AllClear", race_lap: 3, total_laps: 20, cars, own: { A: { est_tyre_loss_s: 0, box_call: null, swap: null }, B: { est_tyre_loss_s: 0, box_call: null, swap: null } }, weather: null, ...over }) as View;

describe("swapOffer", () => {
  it("offers a swap when the second car is directly behind and within 3 s, whichever order the ids are given", () => {
    const v = view([car("X", 1), car("A", 2, { interval_s: 4 }), car("B", 3, { interval_s: 2.4 })]);
    expect(swapOffer(v, ["A", "B"])).toEqual({ ok: true, lead: "A", rear: "B", gap: 2.4 });
    expect(swapOffer(v, ["B", "A"])).toEqual({ ok: true, lead: "A", rear: "B", gap: 2.4 });
  });

  it("refuses with a reason: far apart, car between, not racing, a car out, already pending, one car", () => {
    const base = [car("A", 1), car("B", 2)];
    expect(swapOffer(view([car("A", 1), car("B", 2, { interval_s: 3.4 })]), ["A", "B"])).toMatchObject({ ok: false, reason: expect.stringContaining("over 3") });
    expect(swapOffer(view([car("A", 1), car("X", 2), car("B", 3)]), ["A", "B"])).toMatchObject({ ok: false, reason: "Another car is between yours." });
    for (const s of ["SC", "VSC", "RED", "GRID", "FINISHED"] as const) expect(swapOffer(view(base, { session: s }), ["A", "B"]).ok, s).toBe(false);
    expect(swapOffer(view([car("A", 1), car("B", 2, { status: "RETIRED" })]), ["A", "B"])).toMatchObject({ ok: false, reason: "Both cars must be running." });
    const pending = view(base);
    pending.own.A.swap = { with: "B", anchor: "asap", turn: null, phase: "asked" };
    expect(swapOffer(pending, ["A", "B"])).toMatchObject({ ok: false, reason: "A swap is already pending." });
    expect(swapOffer(view(base), ["A"])).toMatchObject({ ok: false });
    expect(swapOffer(view([car("A", 1), car("B", 2, { interval_s: null })]), ["A", "B"]).ok).toBe(false);
  });
});

describe("anchors", () => {
  it("lists as soon as possible, then before and after each turn in order", () => {
    const o = anchorOptions([{ n: 2, frac: 0.2 }, { n: 1, frac: 0.1 }]);
    expect(o.map((x) => x.label)).toEqual(["As soon as possible", "Before turn 1", "After turn 1", "Before turn 2", "After turn 2"]);
    expect(anchorOptions(undefined)).toHaveLength(1);
  });
  it("round-trips the keys", () => {
    expect(parseAnchor("asap")).toEqual({ anchor: "asap" });
    expect(parseAnchor("before:12")).toEqual({ anchor: "before", turn: 12 });
    expect(parseAnchor(anchorOptions([{ n: 5, frac: 0 }])[2].key)).toEqual({ anchor: "after", turn: 5 });
  });
  it("describes a pending swap", () => {
    expect(swapStatus({ anchor: "asap", turn: null, phase: "asked" })).toBe("Swap as soon as possible: asked the driver");
    expect(swapStatus({ anchor: "before", turn: 12, phase: "lifting" })).toBe("Swap before turn 12: lifting to let the car by");
  });
});

describe("swap messages in the race-control list", () => {
  it("shows acknowledgements, results and failures to the owning team", () => {
    for (const type of ["swap_ack", "swap_done", "swap_failed", "swap_cancelled"])
      expect(describeEvent({ tick: 1, type, payload: { car: "A", message: "Swap confirmed" } }, null)).toEqual({ level: "own", text: "A: Swap confirmed" });
  });
});

describe("swapOffer, the server's other rules", () => {
  it("uses the window the server sends and refuses in the last two laps", () => {
    const close = view([car("A", 1), car("B", 2, { interval_s: 3.4 })]);
    expect(swapOffer(close, ["A", "B"], 4).ok).toBe(true);
    const late = view([car("A", 1, { lap: 18 }), car("B", 2)], { total_laps: 20 });
    expect(swapOffer(late, ["A", "B"])).toMatchObject({ ok: false, reason: "Too late in the race." });
    expect(swapOffer(view([car("A", 1, { lap: 17 }), car("B", 2)], { total_laps: 20 }), ["A", "B"]).ok).toBe(true);
  });
});

describe("rivalsAhead", () => {
  it("lists the nearest rivals ahead by place, whatever the gap values say, and skips own team, the lapped and the stopped", () => {
    const g = (id: string, pos: number, gap: number, over: Partial<CarRow> = {}) => car(id, pos, { gap_to_leader_s: gap, team: "X", ...over });
    // P3 has a larger gap than the car behind it: the old gap test would have dropped it
    const v = view([g("L", 1, 0), g("P", 2, 5), g("S", 3, 12, { team: "Y" }), g("Z", 4, 11), g("W", 5, 9, { status: "IN_PIT" }), g("M", 6, 14, { team: "Y" }), g("ME", 7, 15, { team: "Y" })]);
    expect(rivalsAhead(v, "ME").map((r) => r.c.id)).toEqual(["Z", "P", "L"]);
    expect(rivalsAhead(v, "ME", 2).map((r) => r.c.id)).toEqual(["Z", "P"]);
    expect(rivalsAhead(v, "ME")[0].gap).toBe(4);
  });
});
