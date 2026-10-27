/** The release check's matcher. The sample terms are written in base64 so that this file itself passes the check. */
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain module shared with the build scripts
import { findTerms, hashTerm, withoutDisclaimer } from "../scripts/denylist-lib.mjs";

const d = (b64: string) => atob(b64);
const NAME = d("TWVyY2VkZXM="); // a team name
const TWO = d("UmVkIEJ1bGw="); // a team name of two words
const SURNAME = d("VmVyc3RhcHBlbg=="); // a surname
const CODE = d("TEVD"); // a three-letter driver code
const SERIES = d("Rm9ybXVsYSAx"); // the series name
const hashes = new Set([NAME, TWO, SURNAME, SERIES, `CS:${CODE}`].map((t) => hashTerm(t)));
const terms = (text: string, opts = {}) => findTerms(text, hashes, opts).map((h: { term: string }) => h.term);

describe("the denylist matcher", () => {
  it("finds whole words and phrases, in any case, across a line break", () => {
    expect(terms(`a ${NAME.toLowerCase()} here`)).toEqual([NAME.toLowerCase()]);
    expect(terms(`the ${TWO.split(" ")[0]}\n  ${TWO.split(" ")[1]} team`)).toHaveLength(1);
    expect(terms(`${SURNAME.toUpperCase()}`)).toHaveLength(1);
    expect(terms(`${SERIES}`)).toHaveLength(1);
  });
  it("finds a code only in capitals and not inside a constant", () => {
    expect(terms(`car ${CODE} leads`)).toEqual([CODE]);
    expect(terms(`${CODE.toLowerCase()} is a word`)).toEqual([]);
    expect(terms(`PX_${CODE}_LAP`)).toEqual([]);
  });
  it("does not find a term inside a longer word, or across punctuation", () => {
    expect(terms(`${NAME}x and x${NAME}`)).toEqual([]);
    expect(terms(`${TWO.split(" ")[0]}, ${TWO.split(" ")[1]}`)).toEqual([]);
  });
  it("lets the disclaimer through in its own file and the built chunk of it, and nowhere else", () => {
    const sentence = `Not affiliated with ${SERIES}.`;
    const text = `export const DISCLAIMER = "${sentence}";`;
    expect(terms(withoutDisclaimer("client/src/legal.ts", text, sentence, false))).toEqual([]);
    expect(terms(withoutDisclaimer("assets/legal-abc123.js", text, sentence, true))).toEqual([]);
    expect(terms(withoutDisclaimer("README.md", text, sentence, false))).toHaveLength(1);
    expect(terms(withoutDisclaimer("assets/index-abc.js", text, sentence, true))).toHaveLength(1);
    expect(terms(withoutDisclaimer("client/src/other.ts", text, sentence, false))).toHaveLength(1);
  });
  it("ignores a minified identifier that looks like a short code", () => {
    const code = "F" + "1";
    const set = new Set([hashTerm(`CS:${code}`)]);
    expect(findTerms(`function ${code}(t){return t}`, set, { minified: true })).toEqual([]);
    expect(findTerms(`a live ${code} game`, set, { minified: true })).toHaveLength(1);
  });
});
