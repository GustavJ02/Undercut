/** Short explanations of the strategy terms the screens use. Each screen shows one the first time the term appears on it (components/Gloss.tsx). */
export type Term = "undercut" | "overcut" | "box" | "box opposite" | "VSC" | "SC" | "tyre cliff" | "pit loss" | "dirty air";

export const GLOSSARY: Record<Term, string> = {
  undercut: "Pitting before a rival so that fresh tyres gain more time than the stop costs, and you come out ahead when they stop.",
  overcut: "Staying out after a rival has pitted, using clear air to lap faster until you stop yourself.",
  box: "Come into the pits. \"Box, box\" is the call to the driver to pit this lap.",
  "box opposite": "Do the opposite of a named rival ahead: at your pit entry you box if they stayed out, and stay out if they boxed.",
  VSC: "Virtual safety car: every car must slow to a set pace and keep its gap. A stop costs less.",
  SC: "Safety car: the field bunches up behind it and nobody may pass. A stop costs far less.",
  "tyre cliff": "The point where a tyre suddenly loses much more time each lap. It is hidden: you only see noisy estimates.",
  "pit loss": "The time a stop costs compared with staying out: the pit lane plus the time standing still.",
  "dirty air": "Turbulence behind a car ahead. Following closely loses grip and lap time.",
};

/** The terms that have been explained in one screen. A scope is made per screen; a term claims its place with the id of the element. */
export class GlossScope {
  private owner = new Map<Term, string>();
  /** True for the first element to ask for `term` (and for that same element again). */
  claim(term: Term, id: string): boolean {
    const o = this.owner.get(term);
    if (o === undefined) this.owner.set(term, id);
    return o === undefined || o === id;
  }
}
