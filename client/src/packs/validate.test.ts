import { describe, expect, it } from "vitest";
import { file, manifestFile, minimal, png, wav } from "./testkit";
import { LIMITS, formatIssues, pathProblem, svgProblem, validatePack } from "./validate";

const team = {
  displayName: "Test Team",
  short: "TST",
  colours: { primary: "#112233", secondary: "#445566", accent: "#778899" },
  livery: { pattern: "stripe" as const },
  crew: { kit: "#112233", helmet: "#445566" },
};
const paths = (r: ReturnType<typeof validatePack>) => r.errors.map((e) => e.path);
const text = (r: ReturnType<typeof validatePack>) => formatIssues("p", r.errors);

describe("validatePack", () => {
  it("accepts a minimal manifest and one with assets", () => {
    expect(validatePack([manifestFile(minimal())]).errors).toEqual([]);
    const m = minimal({ teams: { TST: { ...team, livery: { pattern: "solid", image: "assets/car.png" } } }, sounds: { gun: "assets/gun.wav" } });
    const r = validatePack([manifestFile(m), file("assets/car.png", png()), file("assets/gun.wav", wav(1))]);
    expect(r.errors).toEqual([]);
    expect(r.manifest?.id).toBe("test-pack");
  });

  it("requires a manifest and valid JSON", () => {
    expect(text(validatePack([]))).toContain("p:manifest.json: missing");
    expect(text(validatePack([file("manifest.json", "{nope")]))).toContain("is not valid JSON");
  });

  it("rejects unknown keys and says which", () => {
    const r = validatePack([manifestFile({ ...minimal(), script: "x.js" })]);
    expect(text(r)).toContain("unknown key 'script'");
    const t = validatePack([manifestFile(minimal({ teams: { TST: { ...team, evil: 1 } as never } }))]);
    expect(paths(t)).toContain("manifest.json.teams.TST");
  });

  it("checks colours, ranges, ids and reserved tracks", () => {
    const bad = minimal({ teams: { TST: { ...team, colours: { ...team.colours, primary: "red" } } }, tracks: { X: {} as never } });
    const r = validatePack([manifestFile(bad)]);
    expect(paths(r)).toContain("manifest.json.teams.TST.colours.primary");
    expect(paths(r)).toContain("manifest.json.tracks");
    const id = validatePack([manifestFile({ ...minimal(), id: "Bad Id!" })]);
    expect(text(id)).toContain("has the wrong format: expected lowercase letters, digits and dashes, 3 to 40 of them");
    const num = validatePack([manifestFile(minimal({ drivers: { D1: { displayName: "x", number: 100, archetype: "a-b", helmet: { primary: "#000000", secondary: "#000000", pattern: "solid" } } } }))]);
    expect(paths(num)).toContain("manifest.json.drivers.D1.number");
  });

  it("rejects path traversal in files and in references", () => {
    for (const p of ["../x.png", "assets/../../x.png", "/etc/x.png", "assets\\x.png", "C:/x.png", "a//b.png", "a/./b.png"]) {
      expect(pathProblem(p), p).not.toBeNull();
      expect(validatePack([manifestFile(minimal()), file(p, png())]).errors.length, p).toBeGreaterThan(0);
    }
    const m = minimal({ sounds: { gun: "assets/../manifest.json" } });
    expect(validatePack([manifestFile(m)]).errors.length).toBeGreaterThan(0);
    expect(pathProblem("assets/ok/a-b_1.png")).toBeNull();
  });

  it("refuses unknown file types and symlinks", () => {
    for (const p of ["assets/x.js", "assets/x.html", "assets/x.wasm", "assets/x.exe", "assets/noext", "assets/x.png.js", "extra.json"]) {
      const r = validatePack([manifestFile(minimal()), file(p, "x")]);
      expect(r.errors.length, p).toBeGreaterThan(0);
    }
    const r = validatePack([manifestFile(minimal()), { path: "assets/link.png", size: 5, symlink: true }]);
    expect(text(r)).toContain("symbolic links");
  });

  it("enforces size and count caps without needing the bytes", () => {
    const big = { path: "assets/big.png", size: LIMITS.imageBytes + 1 };
    expect(text(validatePack([manifestFile(minimal()), big]))).toContain("limit for .png");
    expect(text(validatePack([manifestFile(minimal()), { path: "assets/a.svg", size: LIMITS.svgBytes + 1 }]))).toContain("limit for .svg");
    expect(text(validatePack([manifestFile(minimal()), { path: "assets/a.ogg", size: LIMITS.audioBytes + 1 }]))).toContain("limit for .ogg");
    const many = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ path: `assets/${i}.png`, size: 1 }));
    expect(text(validatePack([manifestFile(minimal()), ...many]))).toContain("the limit is 400");
    const total = Array.from({ length: 13 }, (_, i) => ({ path: `assets/${i}.png`, size: LIMITS.imageBytes }));
    expect(text(validatePack([manifestFile(minimal()), ...total]))).toContain("MB, the limit is 24");
  });

  it("sniffs content, not just names", () => {
    const fake = validatePack([manifestFile(minimal()), file("assets/a.png", "<html><script>alert(1)</script></html>")]);
    expect(text(fake)).toContain("not a PNG");
    expect(text(validatePack([manifestFile(minimal()), file("assets/a.wav", png())]))).toContain("not a WAV");
    expect(text(validatePack([manifestFile(minimal()), file("assets/a.ogg", png())]))).toContain("not an Ogg");
    expect(text(validatePack([manifestFile(minimal()), file("assets/a.webp", png())]))).toContain("not a WebP");
  });

  it("limits image dimensions and audio length", () => {
    expect(text(validatePack([manifestFile(minimal()), file("assets/a.png", png(5000, 10))]))).toContain("5000x10");
    expect(validatePack([manifestFile(minimal()), file("assets/a.png", png(4096, 4096))]).errors).toEqual([]);
    expect(text(validatePack([manifestFile(minimal()), file("assets/a.wav", wav(25))]))).toContain("25.0 s long");
  });

  it("rejects unsafe SVG and keeps harmless SVG", () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>';
    expect(svgProblem(ok)).toBeNull();
    const bad: Record<string, string> = {
      script: "<svg><script>alert(1)</script></svg>",
      foreign: "<svg><foreignObject><div/></foreignObject></svg>",
      handler: '<svg><rect onclick="x()"/></svg>',
      handlerUpper: '<svg><rect ONLOAD = "x()"/></svg>',
      external: '<svg><image href="https://example.com/a.png"/></svg>',
      xlink: '<svg><use xlink:href="//evil/x.svg#a"/></svg>',
      js: '<svg><a href="javascript:alert(1)"/></svg>',
      cssImport: "<svg><style>@import 'x.css';</style></svg>",
      cssUrl: '<svg><rect style="fill:url(http://x/y)"/></svg>',
      doctype: '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>',
      animate: "<svg><animate attributeName=x/></svg>",
    };
    for (const [name, svg] of Object.entries(bad)) {
      expect(svgProblem(svg), name).not.toBeNull();
      const r = validatePack([manifestFile(minimal()), file("assets/a.svg", svg)]);
      expect(text(r), name).toContain("unsafe SVG");
    }
  });

  it("requires referenced assets to exist and pass", () => {
    const m = minimal({ sounds: { gun: "assets/gun.wav" } });
    expect(text(validatePack([manifestFile(m)]))).toContain("manifest.json:sounds.gun: refers to 'assets/gun.wav'");
    const wrong = validatePack([manifestFile({ ...m, sounds: { gun: "gun.wav" } })]);
    expect(wrong.errors.length).toBeGreaterThan(0);
  });

  it("says what a wrong colour, version, short name and asset path should look like", () => {
    const m = minimal({ version: "1.0", teams: { TST: { ...team, short: "toolong", colours: { ...team.colours, accent: "pink" } } } } as never);
    const out = text(validatePack([manifestFile(m)]));
    expect(out).toContain("manifest.json.version: has the wrong format: expected a version like 1.0.0");
    expect(out).toContain("teams.TST.short: has the wrong format: expected 2 to 4 capital letters or digits, like ABC");
    expect(out).toContain("teams.TST.colours.accent: has the wrong format: expected a colour like #1a2b3c");
    const asset = text(validatePack([manifestFile(minimal({ sounds: { gun: "sounds/gun.mp3" } }))]));
    expect(asset).toContain("expected a path like assets/name.png");
  });

  it("reports every problem at once in a readable form", () => {
    const r = validatePack([manifestFile({ ...minimal(), version: "one", extra: 1 }), file("assets/x.js", "x"), file("../y.png", png())]);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(text(r)).toMatch(/^p:assets\/x\.js: file type '\.js' is not allowed/m);
    expect(text(r)).toContain("p:../y.png: path traversal");
  });
});
