/** The circuits of the game, read from the folders in `circuits/` at the repository root: one `circuit.json` per circuit holds its
 * display data and its outline. The page takes only the fields it uses, so the rest of a file (the simulation numbers, the note on
 * where the outline comes from) is not part of the bundle. A circuit without an outline is drawn as the schematic oval. */
const pick = <T>(glob: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(glob).map(([path, v]) => [path.replace(/^.*\/circuits\/([^/]+)\/circuit\.json$/, "$1"), v]));

export const TRACKS: Record<string, number[][]> = Object.fromEntries(
  Object.entries(pick(import.meta.glob<{ points: number[][] }>("../../circuits/*/circuit.json", { eager: true, import: "outline" }))).map(([id, o]) => [id, o.points]),
);
const names = pick(import.meta.glob<string>("../../circuits/*/circuit.json", { eager: true, import: "name" }));
const places = pick(import.meta.glob<string>("../../circuits/*/circuit.json", { eager: true, import: "place" }));
const countries = pick(import.meta.glob<string>("../../circuits/*/circuit.json", { eager: true, import: "country" }));
const flags = pick(import.meta.glob<string>("../../circuits/*/circuit.json", { eager: true, import: "flag" }));

export interface CircuitEntry {
  name: string;
  place: string;
  country: string;
  flag: string; // a key of the drawn national flags
}

export const CIRCUIT_ENTRIES: Record<string, CircuitEntry> = Object.fromEntries(
  Object.keys(names).map((id) => [id, { name: names[id], place: places[id], country: countries[id], flag: flags[id] }]),
);
