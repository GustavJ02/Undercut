/** Pack validation (docs/presentation-design.md section 5). Pure: it takes the files of a pack as data and returns every problem
 * it finds, so the browser loader and the Node CLI behave the same. A pack with any error is not loaded. Nothing here executes
 * pack content: files are only measured, sniffed and pattern-checked. */
import Ajv from "ajv/dist/2020";
import schema from "./pack.schema.json";
import type { PackManifest } from "./types";

export const LIMITS = {
  manifestBytes: 256 * 1024,
  bundleBytes: 2 * 1024 * 1024, // a pack's own parameter bundle: read by the server, never by the page
  imageBytes: 2 * 1024 * 1024,
  imagePx: 4096,
  audioBytes: 1024 * 1024,
  audioSeconds: 20,
  svgBytes: 200 * 1024,
  packBytes: 24 * 1024 * 1024,
  files: 400,
};

export interface PackFile {
  path: string; // relative to the pack root, forward slashes
  size: number;
  bytes?: Uint8Array; // needed for the manifest and for content checks; may be omitted for size-only checks
  symlink?: boolean;
}

export interface Issue {
  path: string;
  message: string;
}

export interface Validation {
  manifest?: PackManifest;
  errors: Issue[];
}

const ALLOWED = new Set(["png", "webp", "svg", "ogg", "wav", "json"]);
const ajv = new Ajv({ allErrors: true, strict: false });
const checkSchema = ajv.compile(schema);

export function pathProblem(p: string): string | null {
  if (!p) return "empty path";
  if (p.includes("\0")) return "path contains a NUL byte";
  if (p.includes("\\")) return "backslashes are not allowed, use forward slashes";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "absolute paths are not allowed";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return "control characters are not allowed in paths";
  for (const seg of p.split("/")) {
    if (seg === "..") return "path traversal ('..') is not allowed";
    if (seg === "" || seg === ".") return "path has an empty or '.' segment";
  }
  return null;
}

const ext = (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Width and height of a PNG or WebP, or null when the header is unreadable. */
export function imageSize(b: Uint8Array, kind: "png" | "webp"): [number, number] | null {
  if (kind === "png") return b.length >= 24 ? [u32be(b, 16), u32be(b, 20)] : null;
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === "VP8X") return [(b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1];
  if (chunk === "VP8L") {
    const bits = u32le(b, 21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8 ") return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff];
  return null;
}

/** Seconds of a PCM WAV from its header, or null when it is not a plain `fmt `+`data` file. */
export function wavSeconds(b: Uint8Array): number | null {
  let byteRate = 0;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = ascii(b, o, o + 4);
    const size = u32le(b, o + 4);
    if (id === "fmt ") byteRate = u32le(b, o + 16);
    if (id === "data") return byteRate ? size / byteRate : null;
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Why an SVG is refused, or null. An allow-list of the harmless: anything active or external is rejected, never repaired. */
export function svgProblem(text: string): string | null {
  if (/<\s*script/i.test(text)) return "contains a <script> element";
  if (/<\s*foreignObject/i.test(text)) return "contains a <foreignObject> element";
  if (/<\s*(iframe|embed|object|audio|video|animate\b|set\b)/i.test(text)) return "contains an active or embedded element";
  if (/<!\s*(ENTITY|DOCTYPE)/i.test(text)) return "contains a DOCTYPE or ENTITY declaration";
  if (/\son[a-z]+\s*=/i.test(text)) return "contains an event handler attribute (on...=)";
  if (/javascript\s*:/i.test(text)) return "contains a javascript: URL";
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)) {
    if (!m[2].startsWith("#")) return `links to '${m[2].slice(0, 40)}': only #fragment references are allowed`;
  }
  if (/@import|url\(\s*(?!["']?#)/i.test(text)) return "uses @import or an external url(...)";
  return null;
}

function sniff(f: PackFile, kind: string): string | null {
  const b = f.bytes;
  if (!b) return null;
  if (kind === "png" && !(b[0] === 0x89 && ascii(b, 1, 4) === "PNG")) return "is not a PNG (bad file signature)";
  if (kind === "webp" && !(ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP")) return "is not a WebP (bad file signature)";
  if (kind === "ogg" && ascii(b, 0, 4) !== "OggS") return "is not an Ogg file (bad file signature)";
  if (kind === "wav" && !(ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE")) return "is not a WAV (bad file signature)";
  if (kind === "png" || kind === "webp") {
    const wh = imageSize(b, kind);
    if (!wh) return "has an unreadable image header";
    if (wh[0] < 1 || wh[1] < 1 || wh[0] > LIMITS.imagePx || wh[1] > LIMITS.imagePx)
      return `is ${wh[0]}x${wh[1]} px, the limit is ${LIMITS.imagePx} per side`;
  }
  if (kind === "wav") {
    const s = wavSeconds(b);
    if (s !== null && s > LIMITS.audioSeconds) return `is ${s.toFixed(1)} s long, the limit is ${LIMITS.audioSeconds} s`;
  }
  if (kind === "svg") {
    const bad = svgProblem(new TextDecoder().decode(b));
    if (bad) return `is rejected as an unsafe SVG: ${bad}`;
  }
  return null;
}

function sizeLimit(kind: string): number {
  return kind === "svg" ? LIMITS.svgBytes : kind === "ogg" || kind === "wav" ? LIMITS.audioBytes : kind === "json" ? LIMITS.manifestBytes : LIMITS.imageBytes;
}

/** Paths a manifest refers to, with where in the manifest they were found. */
export function referencedAssets(m: PackManifest): [string, string][] {
  const out: [string, string][] = [];
  for (const [id, t] of Object.entries(m.teams ?? {})) if (t.livery.image) out.push([`teams.${id}.livery.image`, t.livery.image]);
  for (const [name, p] of Object.entries(m.sounds ?? {})) if (p) out.push([`sounds.${name}`, p]);
  return out;
}

/** What a value that failed a pattern should look like, in words, from where it is in the manifest. */
function expected(path: string, pattern: string): string {
  const last = path.split(".").pop() ?? "";
  if (/colour|primary|secondary|accent|kit|helmet|skin|^#/.test(last) || pattern.includes("0-9a-fA-F")) return "a colour like #1a2b3c";
  if (last === "version") return "a version like 1.0.0";
  if (last === "short") return "2 to 4 capital letters or digits, like ABC";
  if (last === "id") return "lowercase letters, digits and dashes, 3 to 40 of them";
  if (pattern.startsWith("^assets/")) return "a path like assets/name.png (png, webp, svg, ogg or wav, under assets/)";
  if (pattern.includes("A-Z0-9_")) return "an id of 2 to 12 capital letters, digits or underscores, like ABC";
  if (pattern.includes("a-z0-9_]{2,24}")) return "a circuit id of lowercase letters, digits and underscores, like las_vegas";
  if (pattern.includes("a-z0-9-")) return "lowercase letters, digits and dashes, 2 to 32 of them";
  return `a value matching ${pattern}`;
}

/** The fix hint that goes with the common schema errors, so a modder can act on the message. */
function hint(keyword: string, params: Record<string, unknown>): string {
  switch (keyword) {
    case "additionalProperties":
      return ` (unknown key '${String(params.additionalProperty)}': remove it or check the spelling)`;
    case "required":
      return ` (add the missing key '${String(params.missingProperty)}')`;
    case "pattern":
      return "";
    case "enum":
      return ` (allowed: ${(params.allowedValues as unknown[]).join(", ")})`;
    default:
      return "";
  }
}

export function validatePack(files: PackFile[]): Validation {
  const errors: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (files.length > LIMITS.files) err("", `${files.length} files, the limit is ${LIMITS.files}`);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > LIMITS.packBytes) err("", `pack is ${(total / 1048576).toFixed(1)} MB, the limit is ${LIMITS.packBytes / 1048576} MB`);

  const known = new Set<string>();
  for (const f of files) {
    const bad = pathProblem(f.path);
    if (bad) {
      err(f.path, bad);
      continue;
    }
    if (f.symlink) {
      err(f.path, "symbolic links are not allowed");
      continue;
    }
    const kind = ext(f.path);
    if (!ALLOWED.has(kind)) {
      err(f.path, `file type '.${kind}' is not allowed (allowed: png, webp, svg, ogg, wav, and manifest.json and bundle.json)`);
      continue;
    }
    if (kind === "json" && f.path !== "manifest.json" && f.path !== "bundle.json") {
      err(f.path, "only manifest.json and bundle.json may be JSON files");
      continue;
    }
    const limit = f.path === "bundle.json" ? LIMITS.bundleBytes : sizeLimit(kind);
    if (f.size > limit) {
      err(f.path, `is ${f.size} bytes, the limit for ${f.path === "bundle.json" ? "bundle.json" : "." + kind} is ${limit}`);
      continue;
    }
    const content = sniff(f, kind);
    if (content) {
      err(f.path, content);
      continue;
    }
    known.add(f.path);
  }

  const mf = files.find((f) => f.path === "manifest.json");
  if (!mf || !mf.bytes) {
    err("manifest.json", "missing: a pack needs a manifest.json at its root");
    return { errors };
  }
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(mf.bytes));
  } catch (e) {
    err("manifest.json", `is not valid JSON (${(e as Error).message})`);
    return { errors };
  }
  if (!checkSchema(manifest)) {
    for (const e of checkSchema.errors ?? []) {
      const at = e.instancePath.replace(/\//g, ".");
      err(`manifest.json${at}`, e.keyword === "pattern" ? `has the wrong format: expected ${expected(at, String(e.params.pattern))}` : `${e.message}${hint(e.keyword, e.params)}`);
    }
    return { errors };
  }
  for (const [where, p] of referencedAssets(manifest)) {
    const bad = pathProblem(p);
    if (bad) err(`manifest.json:${where}`, bad);
    else if (!known.has(p)) err(`manifest.json:${where}`, `refers to '${p}', which is not in the pack (or failed a check above)`);
  }
  return errors.length ? { errors } : { manifest, errors };
}

/** One readable block for the mod manager and the CLI: `pack:path: message`. */
export function formatIssues(packId: string, errors: Issue[]): string {
  return errors.map((e) => `${packId}:${e.path || "(pack)"}: ${e.message}`).join("\n");
}
