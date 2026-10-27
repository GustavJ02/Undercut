/** The content packs the page knows about: the base pack, the mods found (validated by the dev server or, later, the game server), and
 * which mod is active. It builds the resolver the render model uses, and tells listeners when it changes, so choosing a mod or editing
 * its files changes the scene at once. Only the active mod is used with the base pack; other mods sit unused until chosen. */
import { BASE_PACK_URL, loadPackFromUrl, urlFor } from "./browser";
import { createResolver, type Resolver } from "./resolve";
import type { LoadedPack } from "./types";

export interface PackEntry {
  source: string;
  folder: string;
  root: string;
  ok: boolean;
  id?: string;
  name?: string;
  version?: string;
  author?: string;
  errors: string[];
}

export class Registry {
  base: LoadedPack | null = null;
  entries: PackEntry[] = [];
  /** Why the list of mods could not be read (no server route), if it could not. */
  listError: string | null = null;
  private mods = new Map<string, LoadedPack>();
  private active: string | null = null;
  private listeners = new Set<() => void>();
  private ready: Promise<void> | null = null;
  version = 0;

  constructor(private fetchJson: (url: string) => Promise<{ packs: PackEntry[] } | null> = defaultFetch, private loadPack: (root: string) => Promise<LoadedPack> = loadPackFromUrl) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** Load the packs once; later calls wait for the same load. */
  ensure(): Promise<void> {
    return (this.ready ??= this.reload());
  }

  /** (Re)read the list of mods and load each usable one. A mod that fails to load is listed with its error, and the rest still work. */
  async reload(): Promise<void> {
    this.base ??= await this.loadPack(BASE_PACK_URL);
    let listed: PackEntry[] = [];
    this.listError = null;
    try {
      const index = await this.fetchJson("/mods/index.json");
      if (index) listed = index.packs;
      else this.listError = "This server does not list mods.";
    } catch (e) {
      this.listError = `Could not read the list of mods: ${(e as Error).message}`;
    }
    const mods = new Map<string, LoadedPack>();
    for (const e of listed) {
      if (!e.ok || !e.id) continue;
      try {
        mods.set(e.id, await this.loadPack(e.root));
      } catch (err) {
        e.ok = false;
        e.errors.push(`${e.id}: could not be loaded by the page (${(err as Error).message})`);
      }
    }
    this.entries = listed;
    this.mods = mods;
    if (this.active && !mods.has(this.active)) this.active = null; // the chosen mod is gone or broke: fall back to the base pack
    this.emit();
  }

  get activeId(): string | null {
    return this.active;
  }

  setActive(id: string | null): void {
    const next = id && this.mods.has(id) ? id : id && !this.ready ? id : null;
    if (next === this.active) return;
    this.active = next;
    this.emit();
  }

  /** Base alone, or base with the active mod on top. */
  resolver(): Resolver {
    const packs = [...(this.base ? [this.base] : []), ...(this.active && this.mods.get(this.active) ? [this.mods.get(this.active)!] : [])];
    return createResolver(packs, urlFor, this.active ?? undefined);
  }
}

async function defaultFetch(url: string): Promise<{ packs: PackEntry[] } | null> {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null; // a single-page app answers unknown routes with its index page
  return r.json();
}

export const registry = new Registry();

if (typeof import.meta !== "undefined" && import.meta.hot) import.meta.hot.on("undercut:mods-changed", () => void registry.reload());
