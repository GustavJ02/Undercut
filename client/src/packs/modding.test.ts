import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import schema from "./pack.schema.json";
import { LIMITS } from "./validate";

const DOC = readFileSync(resolve(__dirname, "../../../docs/modding.md"), "utf8");

/** Every property name the schema knows. */
function keys(node: unknown, out = new Set<string>()): Set<string> {
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.properties && typeof o.properties === "object") for (const [k, v] of Object.entries(o.properties as object)) { out.add(k); keys(v, out); }
    for (const v of Object.values(o)) keys(v, out);
  }
  return out;
}

describe("docs/modding.md stays in step with the schema and the limits", () => {
  it("documents every property of the manifest schema", () => {
    for (const k of keys(schema)) expect(DOC, `property ${k}`).toContain(`\`${k}\``);
  });

  it("states every limit the validator enforces, with its number", () => {
    for (const n of [LIMITS.manifestBytes, LIMITS.bundleBytes, LIMITS.imageBytes, LIMITS.imagePx, LIMITS.audioBytes, LIMITS.audioSeconds, LIMITS.svgBytes, LIMITS.packBytes, LIMITS.files]) expect(DOC, String(n)).toContain(String(n));
  });

  it("lists the enumerated values: patterns, builds, hair, roles, sound names", () => {
    const defs = (schema as { $defs: Record<string, any> }).$defs;
    const words = [...defs.pattern.enum, ...defs.archetype.properties.build.enum, ...defs.archetype.properties.hair.enum, ...defs.archetype.properties.role.enum, ...Object.keys({}), ...(schema as any).properties.sounds.propertyNames.enum];
    for (const w of words) expect(DOC, w).toContain(`\`${w}\``);
  });

  it("has a worked example that passes the validator", async () => {
    const m = /```json\n([\s\S]*?)\n```/.exec(DOC);
    expect(m).not.toBeNull();
    const { validatePack } = await import("./validate");
    const manifest = JSON.parse(m![1]);
    const enc = new TextEncoder().encode(JSON.stringify(manifest));
    // the example names a sound file; give it a minimal valid WAV header so only the manifest is under test
    const wav = new Uint8Array(44);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);
    wav.set(new TextEncoder().encode("fmt "), 12);
    new DataView(wav.buffer).setUint32(28, 8000, true);
    wav.set(new TextEncoder().encode("data"), 36);
    new DataView(wav.buffer).setUint32(40, 8000, true);
    const r = validatePack([{ path: "manifest.json", size: enc.length, bytes: enc }, { path: "assets/beep.wav", size: wav.length, bytes: wav }]);
    expect(r.errors).toEqual([]);
  });
});
