import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, ContractError, EVENTS, assertMessage, checkMessage } from "./contract";

const CLIENT = resolve(__dirname, "../..");
const FIXTURES = join(CLIENT, "fixtures");
const raceFiles = readdirSync(FIXTURES).filter((n) => /^race-.*-\d+\.json$/.test(n) && !n.includes("hidden"));
const load = (dir: string, name: string): { messages: Record<string, any>[] } => JSON.parse(readFileSync(join(dir, name), "utf8"));
const first = (type: string, dir = FIXTURES) => structuredClone(load(dir, raceFiles[0]).messages.find((m) => m.type === type)!);

describe("contract v1 against recorded races", () => {
  it("has fixtures", () => {
    expect(CONTRACT_VERSION).toBe(1);
    expect(raceFiles.length).toBeGreaterThanOrEqual(2);
  });

  it.each(raceFiles)("accepts every message in %s", (name) => {
    const messages = load(FIXTURES, name).messages;
    const problems = messages.flatMap((m, i) => checkMessage(m).map((p) => `#${i} ${p}`));
    expect(problems).toEqual([]);
  });

  it("covers the event types the renderer reads (safety car or VSC, pit, pass, retirement)", () => {
    const seen = new Set(raceFiles.flatMap((n) => load(FIXTURES, n).messages.filter((m) => m.type === "event").map((m) => m.event.type)));
    for (const t of ["pass", "pit_in", "pit_out", "retirement", "safety_deployed", "safety_ended", "finish", "classification", "box_ack"]) expect(seen.has(t), t).toBe(true);
    for (const t of seen) expect(EVENTS[t as string], `contract lists '${t}'`).toBeDefined();
  });
});

describe("drift is reported loudly, field by field", () => {
  it("a field the server removes", () => {
    const m = first("state");
    delete m.view.cars[3].lap_frac;
    expect(checkMessage(m)).toEqual(["view.cars[3].lap_frac: missing (the renderer reads it)"]);
  });

  it("a field the server renames", () => {
    const m = first("state");
    m.view.cars[0].lap_fraction = m.view.cars[0].lap_frac;
    delete m.view.cars[0].lap_frac;
    const p = checkMessage(m).join("\n");
    expect(p).toContain("view.cars[0].lap_frac: missing");
    expect(p).toContain("view.cars[0].lap_fraction: new field from the server");
  });

  it("a field whose type or value changes", () => {
    const m = first("state");
    m.view.cars[1].lap_frac = "0.5";
    m.view.session = "PARADE";
    const p = checkMessage(m);
    expect(p).toContain("view.cars[1].lap_frac: is string, expected num");
    expect(p.join()).toContain('view.session: is "PARADE", expected one of GRID, RACING');
  });

  it("a new event type, new payload field, or new message type", () => {
    const e = first("event");
    e.event.type = "drs_open";
    expect(checkMessage(e).join()).toContain("unknown event 'drs_open'");
    const pit = load(FIXTURES, raceFiles[0]).messages.find((m) => m.type === "event" && m.event.type === "pit_in")!;
    const mutated = structuredClone(pit);
    mutated.event.payload.stationary_s = 2.1;
    expect(checkMessage(mutated).join()).toContain("event[pit_in].payload.stationary_s: new field");
    expect(checkMessage({ type: "telemetry" })).toEqual(["message.type: unknown message type 'telemetry'"]);
  });

  it("assertMessage throws a readable ContractError", () => {
    const m = first("clock");
    delete m.tick;
    expect(() => assertMessage(m)).toThrow(ContractError);
    expect(() => assertMessage(m)).toThrow(/presentation contract v1:\n {2}clock\.tick: missing/);
  });

  it("a snapshot checks its nested info, view and clock", () => {
    const m = first("snapshot");
    delete m.info.circuit;
    m.clock.speed = null;
    const p = checkMessage(m);
    expect(p).toContain("snapshot.info.circuit: missing (the renderer reads it)");
    expect(p).toContain("snapshot.clock.speed: is null");
  });
});

// `npm run contract`: record a fresh race from the current backend and check it, so drift in server/ shows up without waiting
// for someone to re-record the fixtures. Skipped in a plain `npm test` because it runs the engine.
describe.runIf(process.env.UNDERCUT_CONTRACT_LIVE === "1")("live backend", () => {
  it("a race recorded now fits the contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "undercut-contract-"));
    try {
      const py = process.env.UNDERCUT_PYTHON ?? resolve(CLIENT, "../venv/bin/python");
      execFileSync("nice", [py, join(CLIENT, "scripts/record_fixture.py"), "--seed", "8", "--laps", "6", "--out", dir], { stdio: "pipe" });
      const messages = load(dir, "race-austin-8.json").messages;
      expect(messages.flatMap((m, i) => checkMessage(m).map((p) => `#${i} ${p}`))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
