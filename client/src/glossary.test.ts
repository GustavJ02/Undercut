import { describe, expect, it } from "vitest";
import { GLOSSARY, GlossScope, type Term } from "./glossary";

describe("glossary scope", () => {
  it("explains a term for the first element that asks, again for that same element, and for nobody else", () => {
    const s = new GlossScope();
    expect(s.claim("undercut", "a")).toBe(true);
    expect(s.claim("undercut", "b")).toBe(false);
    expect(s.claim("undercut", "a")).toBe(true);
    expect(s.claim("overcut", "b")).toBe(true);
  });
  it("starts afresh for every screen", () => {
    expect(new GlossScope().claim("box", "x")).toBe(true);
    expect(new GlossScope().claim("box", "y")).toBe(true);
  });
  it("has a short explanation for each term", () => {
    for (const t of Object.keys(GLOSSARY) as Term[]) expect(GLOSSARY[t].length).toBeLessThan(180);
    expect(Object.keys(GLOSSARY)).toHaveLength(9);
  });
});
