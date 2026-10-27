import { describe, expect, it } from "vitest";
import { markSeen, seenBefore } from "./introSeen";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("introSeen", () => {
  it("remembers rooms and nothing else", () => {
    const s = store();
    expect(seenBefore("a", s)).toBe(false);
    markSeen("a", s);
    markSeen("b", s);
    markSeen("a", s);
    expect([seenBefore("a", s), seenBefore("b", s), seenBefore("c", s)]).toEqual([true, true, false]);
  });
  it("keeps only the latest 50 rooms", () => {
    const s = store();
    for (let i = 0; i < 60; i++) markSeen(`r${i}`, s);
    expect(seenBefore("r0", s)).toBe(false);
    expect(seenBefore("r59", s)).toBe(true);
  });
  it("survives missing, corrupt or throwing storage", () => {
    expect(seenBefore("a", undefined)).toBe(false);
    expect(seenBefore("a", { getItem: () => "{broken", setItem: () => undefined })).toBe(false);
    expect(seenBefore("a", { getItem: () => '{"x":1}', setItem: () => undefined })).toBe(false);
    expect(() => markSeen("a", { getItem: () => null, setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => markSeen("a", undefined)).not.toThrow();
  });
});
