import type { Compound } from "../types";

const LETTER: Record<Compound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

export function Tyre({ compound, big = false }: { compound: Compound; big?: boolean }) {
  return (
    <span className={`tyre tyre-${compound.toLowerCase()}${big ? " tyre-big" : ""}`} title={compound.toLowerCase()}>
      {LETTER[compound]}
    </span>
  );
}
