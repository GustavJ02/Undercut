import { afterEach, describe, expect, it, vi } from "vitest";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
afterEach(() => vi.unstubAllGlobals());

describe("the multiplayer seat is per tab", () => {
  it("restores in the tab that saved it, and is only offered as a rejoin to another tab", async () => {
    const local = memory();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memory());
    const { saveSeat, lastSeat } = await import("./App");
    const seat = { roomId: "ABCDE", team: "VMR", seat: "s3cret", multiplayer: true };
    saveSeat(seat);
    expect(lastSeat()).toEqual(seat);
    vi.stubGlobal("sessionStorage", memory()); // a second tab: no session of its own
    const { savedSeat } = await import("./App");
    expect(savedSeat()).toBeNull();
    expect(lastSeat()).toEqual(seat);
    saveSeat(null);
    expect(lastSeat()).toBeNull();
  });
});
