/** The contract between the server's visible state and the presentation layer (docs/presentation-design.md section 2).
 *
 * `SPEC` lists every field the server sends today, whether the renderer reads it or lists it as ignored, and what type it has.
 * `checkMessage` compares a message with it: a missing field, a wrong type or value, or a field the server has started sending
 * that is not listed here are all reported, so a change in `server/visibility.py` or `server/protocol.py` fails the contract
 * test with a field-level message instead of breaking the scene quietly. A new field is fine once someone decides whether the
 * renderer reads it: add it to SPEC. Bump CONTRACT_VERSION when the renderer starts to rely on a different shape.
 */
export const CONTRACT_VERSION = 1;

/** `num`, `str`, `bool`, `arr`, `obj`; a trailing `?` allows null; `enum:A|B` is one of the values. `read` marks fields the renderer uses. */
type Kind = string;
interface Field {
  kind: Kind;
  read: boolean;
  optional?: boolean; // may be absent (the server omits it in some states)
}
type Shape = Record<string, Field>;

const f = (kind: Kind, read = false, optional = false): Field => ({ kind, read, optional });
const COMPOUNDS = "enum:SOFT|MEDIUM|HARD|INTERMEDIATE|WET";
const SESSIONS = "enum:GRID|RACING|SC|VSC|RED|FINISHED";

export const SPEC: Record<string, Shape> = {
  view: {
    time_s: f("num", true),
    session: f(SESSIONS, true),
    track_status: f("enum:AllClear|SCDeployed|VSCDeployed|Red", true),
    race_lap: f("num", true),
    total_laps: f("num", true),
    cars: f("arr", true),
    own: f("obj", true),
    safety_car: f("obj?", true, true), // where the safety car is while it is on the track
    weather: f("obj?", true, true), // the scene reads `raining` and `track`; the forecast stays out of the render model
  },
  car: {
    id: f("str", true),
    team: f("str", true),
    driver: f("str"), // a display name: identities resolve through the pack, never from this
    position: f("num", true),
    lap: f("num", true),
    status: f("enum:RUNNING|IN_PIT|FINISHED|RETIRED", true),
    lap_frac: f("num", true),
    compound: f(COMPOUNDS, true),
    tyre_age: f("num", true),
    stops: f("num", true),
    compounds_used: f("arr"),
    sets_remaining: f("obj"),
    last_lap_s: f("num?"),
    gap_to_leader_s: f("num?", true),
    interval_s: f("num?", true),
    laps_down: f("num"),
    penalised: f("bool", false, true), // the results screen, not the scene
  },
  own: {
    est_tyre_loss_s: f("num"), // the team's noisy estimate: deliberately not read by the scene
    dirty_air_loss_s: f("num", false, true), // own team only: pace lost to the car in front
    damage_loss_s: f("num", false, true),
    box_call: f("obj?", true),
    order: f("obj?", false, true), // own team: the standing box-opposite order
    swap: f("obj?", false, true), // a pending team-order swap: gameplay UI, not read by the scene (added by the backend after the fixtures were recorded)
  },
  clock: {
    type: f("str", false, true), // present in a snapshot's clock, where it is the whole `clock` message
    time_s: f("num", true),
    tick: f("num", true),
    speed: f("num", true),
    paused: f("bool", true),
    pause_allowed: f("bool"),
    session: f(SESSIONS, true),
    multiplayer: f("bool", false, true), // lobby and game screens, not the scene
    players: f("arr", false, true),
    vote: f("obj?", false, true), // multiplayer: a speed increase waiting for every player
    vote_note: f("obj", false, true),
  },
  info: {
    id: f("str"),
    engine_version: f("str"),
    circuit: f("str", true),
    total_laps: f("num", true),
    human_team: f("str?", true),
    human_cars: f("arr", true),
    multiplayer: f("bool", false, true),
    host: f("str?", false, true),
    players: f("arr", false, true),
    swap_window_s: f("num", false, true), // the team-order control, not the scene
    full_laps: f("num", false, true), // the pre-race briefing, not the scene
    pit_loss_s: f("num", false, true), // strategist screen, not the scene
    pit_loss_sc_s: f("num", false, true),
    pit_loss_vsc_s: f("num", false, true),
    pit_call_deadline_frac: f("num", false, true), // the pit-wall driver cards, not the scene
    traffic_window_s: f("num", false, true),
    fuel_s_per_lap: f("num", false, true),
    sc_rate_per_lap: f("num", false, true),
    lap_length_m: f("num", false, true),
    tyre_guide: f("obj", false, true), // strategist screen: public compound averages for the start-tyre page
    corners: f("arr", true, true), // [{n, frac}] in lap order: the scene marks the turns on the outline
  },
};

/** Payload fields per public or own event type, all optional (the server keeps only the ones an event has). `read` events drive the scene. */
export const EVENTS: Record<string, { read: boolean; fields: Shape }> = {
  lights_out: { read: true, fields: { grid: f("arr") } },
  lap: { read: false, fields: { car: f("str"), lap: f("num"), lap_time: f("num"), compound: f(COMPOUNDS), age: f("num"), flags: f("str", false, true) } },
  pass: { read: true, fields: { car: f("str", true), passed: f("str", true) } },
  pit_in: { read: true, fields: { car: f("str", true), stop: f("num"), compound: f(COMPOUNDS, false, true) } },
  pit_out: { read: true, fields: { car: f("str", true), compound: f(COMPOUNDS), stop: f("num") } },
  safety_deployed: { read: true, fields: { kind: f("enum:SC|VSC", true) } },
  safety_ended: { read: true, fields: { kind: f("enum:SC|VSC", true) } },
  safety_ending: { read: true, fields: { kind: f("enum:SC|VSC", true) } },
  red_flag: { read: true, fields: { lap: f("num") } },
  restart: { read: true, fields: { order: f("arr"), lap: f("num") } },
  tyre_change: { read: false, fields: { car: f("str"), compound: f(COMPOUNDS) } },
  retirement: { read: true, fields: { car: f("str", true), lap: f("num") } },
  contact: { read: true, fields: { cars: f("arr", true), lap: f("num") } },
  local_yellow: { read: true, fields: { car: f("str", true), lap: f("num") } },
  finish: { read: true, fields: { car: f("str", true), laps: f("num"), time: f("num") } },
  classification: { read: true, fields: { order: f("arr", true) } },
  penalty: { read: false, fields: { car: f("str"), reason: f("str") } },
  box_ack: { read: true, fields: { car: f("str", true), ok: f("bool"), message: f("str"), effective_lap: f("num") } },
  action_rejected: { read: false, fields: { car: f("str"), reason: f("str") } },
  radio: { read: true, fields: { id: f("num"), car: f("str", true), from: f("enum:driver|engineer"), speaker: f("str"), message: f("str"), topic: f("str"), reply_to: f("num?"), request: f("obj?") } },
  radio_request_closed: { read: false, fields: { id: f("num"), car: f("str"), reason: f("enum:accepted|declined|expired") } },
  swap_ack: { read: false, fields: { car: f("str"), ok: f("bool"), message: f("str") } },
  swap_done: { read: false, fields: { car: f("str"), with_car: f("str"), kind: f("enum:straight|link|corner"), message: f("str") } },
  swap_failed: { read: false, fields: { car: f("str"), message: f("str") } },
  swap_cancelled: { read: false, fields: { car: f("str"), message: f("str") } },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function kindProblem(kind: Kind, v: unknown): string | null {
  const nullable = kind.endsWith("?");
  const k = nullable ? kind.slice(0, -1) : kind;
  if (v === null) return nullable ? null : "is null";
  if (k.startsWith("enum:")) {
    const allowed = k.slice(5).split("|");
    return allowed.includes(String(v)) ? null : `is ${JSON.stringify(v)}, expected one of ${allowed.join(", ")}`;
  }
  const ok: Record<string, boolean> = {
    num: typeof v === "number" && Number.isFinite(v),
    str: typeof v === "string",
    bool: typeof v === "boolean",
    arr: Array.isArray(v),
    obj: isObj(v),
  };
  return ok[k] ? null : `is ${Array.isArray(v) ? "an array" : typeof v}, expected ${k}`;
}

/** Problems of one object against a shape, each as `where.field: what`. */
export function checkShape(where: string, shape: Shape, v: unknown, all = true): string[] {
  if (!isObj(v)) return [`${where}: expected an object`];
  const out: string[] = [];
  for (const [name, spec] of Object.entries(shape)) {
    if (!(name in v)) {
      if (all && !spec.optional) out.push(`${where}.${name}: missing (the renderer ${spec.read ? "reads" : "expects"} it)`);
      continue;
    }
    const bad = kindProblem(spec.kind, v[name]);
    if (bad) out.push(`${where}.${name}: ${bad}`);
  }
  for (const name of Object.keys(v)) {
    if (!(name in shape)) out.push(`${where}.${name}: new field from the server, not in the contract (decide if the renderer reads it, then add it to SPEC)`);
  }
  return out;
}

export function checkView(view: unknown): string[] {
  const out = checkShape("view", SPEC.view, view);
  if (!isObj(view)) return out;
  if (Array.isArray(view.cars)) view.cars.forEach((c, i) => out.push(...checkShape(`view.cars[${i}]`, SPEC.car, c)));
  if (isObj(view.own)) for (const [id, o] of Object.entries(view.own)) out.push(...checkShape(`view.own.${id}`, SPEC.own, o));
  return out;
}

export function checkEvent(e: unknown): string[] {
  if (!isObj(e)) return ["event: expected an object"];
  const out = checkShape("event", { tick: f("num", true), type: f("str", true), payload: f("obj", true) }, e);
  const spec = typeof e.type === "string" ? EVENTS[e.type] : undefined;
  if (typeof e.type === "string" && !spec) out.push(`event.type: unknown event '${e.type}' (the server sends an event the contract does not list)`);
  if (spec && isObj(e.payload)) out.push(...checkShape(`event[${e.type}].payload`, spec.fields, e.payload, false));
  return out;
}

export const checkClock = (c: unknown) => checkShape("clock", SPEC.clock, c);

/** Problems with one server message (snapshot, state, event or clock); empty means it fits the contract. */
export function checkMessage(m: unknown): string[] {
  if (!isObj(m)) return ["message: expected an object"];
  switch (m.type) {
    case "snapshot":
      return [
        ...checkShape("snapshot", { type: f("str"), info: f("obj", true), view: f("obj", true), clock: f("obj", true), history: f("arr"), laps: f("obj", false, true) }, m),
        ...checkShape("snapshot.info", SPEC.info, m.info),
        ...checkView(m.view).map((p) => `snapshot.${p}`),
        ...checkClock(m.clock).map((p) => `snapshot.${p}`),
        ...(Array.isArray(m.history) ? m.history.flatMap((e) => checkEvent(e)) : []),
      ];
    case "state":
      return [...checkShape("state", { type: f("str"), view: f("obj", true) }, m), ...checkView(m.view)];
    case "event":
      return [...checkShape("event message", { type: f("str"), event: f("obj", true) }, m), ...checkEvent(m.event)];
    case "clock": {
      const { type: _t, ...rest } = m;
      return checkClock(rest);
    }
    default:
      return [`message.type: unknown message type '${String(m.type)}'`];
  }
}

export class ContractError extends Error {
  constructor(public problems: string[]) {
    super(`server message does not match presentation contract v${CONTRACT_VERSION}:\n  ${problems.slice(0, 12).join("\n  ")}${problems.length > 12 ? `\n  ... and ${problems.length - 12} more` : ""}`);
  }
}

export function assertMessage(m: unknown): void {
  const p = checkMessage(m);
  if (p.length) throw new ContractError(p);
}
