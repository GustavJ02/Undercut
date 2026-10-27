import { describe, expect, it } from "vitest";
import { declutter } from "./TrackScene";

const node = (x: number, y: number) => ({ root: { x, y }, label: { y: -10, visible: false } });

describe("declutter", () => {
  it("keeps the first of two labels that would overlap and shows the others", () => {
    const [a, b, c] = [node(100, 100), node(104, 101), node(400, 100)];
    declutter([a, b, c], 1);
    expect([a.label.visible, b.label.visible, c.label.visible]).toEqual([true, false, true]);
  });
  it("lets labels come back when the cars spread out", () => {
    const [a, b] = [node(100, 100), node(104, 101)];
    declutter([a, b], 1);
    b.root.x = 300;
    declutter([a, b], 1);
    expect(b.label.visible).toBe(true);
  });
});
