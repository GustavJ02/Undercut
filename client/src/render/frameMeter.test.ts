import { describe, expect, it } from "vitest";
import { FrameMeter } from "./frameMeter";

describe("FrameMeter", () => {
  it("is zero when empty", () => {
    const m = new FrameMeter();
    expect([m.mean, m.p95, m.fps, m.count, m.max]).toEqual([0, 0, 0, 0, 0]);
  });
  it("reports mean, p95 and fps over a rolling window", () => {
    const m = new FrameMeter(100);
    for (let i = 0; i < 95; i++) m.add(10);
    for (let i = 0; i < 5; i++) m.add(40);
    expect(m.mean).toBeCloseTo(11.5);
    expect(m.p95).toBe(10);
    m.add(40);
    expect(m.p95).toBe(40);
    expect(m.max).toBe(40);
    expect(m.fps).toBeCloseTo(1000 / m.mean);
  });
  it("forgets frames older than the window", () => {
    const m = new FrameMeter(10);
    for (let i = 0; i < 10; i++) m.add(100);
    for (let i = 0; i < 10; i++) m.add(5);
    expect([m.count, m.mean]).toEqual([10, 5]);
  });
});
