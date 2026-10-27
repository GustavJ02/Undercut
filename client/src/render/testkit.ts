import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadFiles } from "../packs/loader";
import { readPackDir } from "../packs/readDir";
import { createResolver } from "../packs/resolve";
import type { LoadedPack } from "../packs/types";
import { BASE } from "../packs/testkit";
import { ModelStore, type Incoming } from "./store";
import type { SynthOptions } from "./synth";

export const FIXTURES = resolve(__dirname, "../../fixtures");
export const basePack = loadFiles(BASE, readPackDir(BASE)).pack as LoadedPack;
export const urlFor = (p: LoadedPack, path: string) => `/${p.manifest.id}/${path}`;
export const baseResolver = createResolver([basePack], urlFor);
export const fixture = (name: string): Incoming[] => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")).messages.map((m: any) => (m.type === "event" ? { type: "event", event: m.event } : m));
export const hiddenOf = (name: string): Record<string, Record<string, number>>[] => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** Ids of the cars in the base pack, two per team, for synthetic races. */
export const baseCars = (): SynthOptions["carIds"] =>
  Object.entries(basePack.manifest.drivers!).map(([id], i) => ({ id, team: Object.keys(basePack.manifest.teams!)[Math.floor(i / 2)] }));

/** Feed messages to a store, one wall millisecond per message, returning the model after each state. */
export function play(messages: Iterable<Incoming>, store = new ModelStore(baseResolver)) {
  const models = [];
  let now = 0;
  for (const m of messages) {
    store.push(m, (now += 16));
    if (m.type === "state" || m.type === "snapshot") models.push(store.model!);
  }
  return { store, models };
}
