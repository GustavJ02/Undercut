/** Helpers for pack tests: in-memory pack files with valid image and audio headers. */
import { resolve } from "node:path";
import type { PackManifest } from "./types";
import type { PackFile } from "./validate";

const enc = (s: string) => new TextEncoder().encode(s);

export function png(w = 16, h = 16): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set(enc("IHDR"), 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

export function wav(seconds: number): Uint8Array {
  const rate = 8000;
  const data = Math.round(seconds * rate);
  const b = new Uint8Array(44);
  const v = new DataView(b.buffer);
  b.set(enc("RIFF"), 0);
  b.set(enc("WAVE"), 8);
  b.set(enc("fmt "), 12);
  v.setUint32(16, 16, true);
  v.setUint32(28, rate, true);
  b.set(enc("data"), 36);
  v.setUint32(40, data, true);
  return b;
}

export const file = (path: string, bytes: Uint8Array | string, size?: number): PackFile => {
  const b = typeof bytes === "string" ? enc(bytes) : bytes;
  return { path, bytes: b, size: size ?? b.length };
};

export const minimal = (extra: Partial<PackManifest> = {}): PackManifest => ({
  schema: 1,
  id: "test-pack",
  name: "Test",
  version: "1.0.0",
  author: "tests",
  licence: "CC0-1.0",
  kind: "mod",
  ...extra,
});

export const manifestFile = (m: unknown): PackFile => file("manifest.json", JSON.stringify(m));

export const BASE = resolve(__dirname, "../../public/packs/base-fictional");
