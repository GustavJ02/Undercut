// Shared by the release check and by the (private) tool that makes the hash file.
//
// The denylist is never stored as text in this repository: only the SHA-256 of each term, so the list can ship without containing what it
// forbids. A term is matched as whole words: the text is split into runs of letters and digits, and every run of one to four of them is
// normalised (lower case, joined by single spaces) and hashed. A term written in capitals in the list ("CS:" in the source list) is a code:
// it matches only a single run that is exactly those capitals, so "ABC" is found but the word "abc" is not.
import { createHash } from "node:crypto";

export const MAX_WORDS = 4;
const WORD = /[\p{L}\p{N}]+/gu;
// between the words of a multi-word term: spaces, line breaks, hyphens, dots and apostrophes, but no other punctuation
const JOIN = /^[\s\-.'’]+$/;

export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const normalise = (words) => words.map((w) => w.toLowerCase()).join(" ");
export const hashTerm = (term) => (term.startsWith("CS:") ? sha(term) : sha(normalise(term.split(/[^\p{L}\p{N}]+/u).filter(Boolean))));

/** Every hit of a denylist (a Set of hashes) in `text`: { term: "<the matched text>", index }. Runs of digits alone never start a match. */
export function findTerms(text, hashes, { minified = false } = {}) {
  const words = [...text.matchAll(WORD)].map((m) => ({ w: m[0], i: m.index, snake: text[m.index - 1] === "_" || text[m.index + m[0].length] === "_" }));
  const hits = [];
  for (let k = 0; k < words.length; k++) {
    if (/^[0-9]+$/.test(words[k].w)) continue;
    // a code written in capitals, but not a part of a constant such as PX_PER_LAP
    if (!words[k].snake && words[k].w.length >= 2 && words[k].w === words[k].w.toUpperCase() && hashes.has(sha("CS:" + words[k].w)) && !keyTable(text, words[k]) && !identifier(text, words[k], minified)) hits.push({ term: words[k].w, index: words[k].i });
    for (let n = 1; n <= MAX_WORDS && k + n <= words.length; n++) {
      if (n > 1 && !JOIN.test(text.slice(words[k + n - 2].i + words[k + n - 2].w.length, words[k + n - 1].i))) break;
      const run = words.slice(k, k + n).map((x) => x.w);
      if (hashes.has(sha(normalise(run)))) hits.push({ term: run.join(" "), index: words[k].i });
    }
  }
  return hits;
}

const FK = "F" + "1"; // written in two parts so that this file does not hold the term it guards against
/** The first function key in a table of function keys (it is followed by the second) is a keyboard key, not the series. */
const keyTable = (text, word) => word.w === FK && /F2\W/.test(text.slice(word.i, word.i + 16));

/** In minified code a short capital token (a letter and a digit) is usually a variable name: only count it when it stands in running text (a space, a quote or a stop after it). */
const identifier = (text, word, minified) => minified && /^[A-Z][0-9]$/.test(word.w) && !/[\s"'`.\-]/.test(text[word.i + word.w.length] ?? " ");

/** Where the disclaimer sentence may appear: its own source file, or the chunk built from it. Returns the text with the sentence taken out
 * there, and the text unchanged anywhere else (so the same sentence in another file is found like any other hit). */
export const withoutDisclaimer = (rel, text, disclaimer, dist) =>
  (dist ? /^assets\/legal-[^/]+\.js$/.test(rel) : rel === "client/src/legal.ts") ? text.split(disclaimer).join(" ") : text;
