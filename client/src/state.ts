import type { Clock, Compound, GameEvent, LapRow, LapTable, RadioLine, RaceInfo, ServerMessage, View } from "./types";

export interface Message {
  key: number;
  tick: number;
  level: "info" | "own" | "alert";
  text: string;
}

export interface RaceState {
  info: RaceInfo | null;
  view: View | null;
  clock: Clock | null;
  messages: Message[];
  radio: RadioLine[]; // the team's radio transcript, oldest first
  requests: RadioLine[]; // driver requests still waiting for an answer
  laps: LapTable; // every car's public lap times, for the strategist screen
  error: string | null;
  nextKey: number;
}

export const initialState: RaceState = { info: null, view: null, clock: null, messages: [], radio: [], requests: [], laps: {}, error: null, nextKey: 1 };

/** How a driver is named in a line of text: the active pack's surname (the page sets this when the packs load). An ID is never shown. */
let surnameOf: (id: string) => string = (id) => id;
export const setSurnames = (f: (id: string) => string): void => {
  surnameOf = f;
};
const name = (_v: View | null, id: unknown) => surnameOf(String(id));

/** One line of race-control or team-radio text for an event the team may see, or null for events that need no message. */
export function describe(e: GameEvent, view: View | null): Pick<Message, "level" | "text"> | null {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case "box_ack":
      return { level: "own", text: `${p.car}: ${p.message}` };
    case "radio": // shown in the radio panel, not in the race control list
    case "radio_request_closed":
      return null;
    case "swap_ack":
    case "swap_done":
    case "swap_failed":
    case "swap_cancelled":
      return { level: "own", text: `${p.car}: ${p.message}` };
    case "action_rejected":
      return { level: "own", text: `${p.car}: ${p.reason}` };
    case "safety_deployed":
      return { level: "alert", text: p.kind === "SC" ? "SAFETY CAR DEPLOYED" : "VIRTUAL SAFETY CAR DEPLOYED" };
    case "safety_ending":
      return { level: "alert", text: p.kind === "SC" ? "SAFETY CAR IN THIS LAP" : "VSC ENDING" };
    case "safety_ended":
      return { level: "alert", text: p.kind === "SC" ? "SAFETY CAR IN, GREEN FLAG" : "VSC ENDING, GREEN FLAG" };
    case "red_flag":
      return { level: "alert", text: "RED FLAG: the race is stopped. Tyre changes are free until the restart." };
    case "restart":
      return { level: "alert", text: "Standing restart, lights out" };
    case "tyre_change":
      return { level: "info", text: `${name(view, p.car)} changes to ${String(p.compound).toLowerCase()} tyres (red flag)` };
    case "retirement":
      return { level: "alert", text: `${name(view, p.car)} retires` };
    case "contact":
      return { level: "alert", text: `Contact between ${(p.cars as string[]).map((c) => name(view, c)).join(" and ")}` };
    case "local_yellow":
      return { level: "info", text: `Yellow flag, ${name(view, p.car)} stopped` };
    case "pit_in":
      return { level: "info", text: `${name(view, p.car)} in the pits (stop ${p.stop})` };
    case "pass":
      return { level: "info", text: `${name(view, p.car)} passes ${name(view, p.passed)}` };
    case "penalty":
      return { level: "alert", text: `${name(view, p.car)}: ${p.reason}` };
    case "classification":
      return { level: "alert", text: "CHEQUERED FLAG" };
    default:
      return null;
  }
}

const MAX_MESSAGES = 120;
const MAX_RADIO = 200;

export function reduce(state: RaceState, msg: ServerMessage): RaceState {
  switch (msg.type) {
    case "snapshot": {
      const out: RaceState = { ...initialState, info: msg.info, view: msg.view, clock: msg.clock, laps: structuredClone(msg.laps ?? {}), nextKey: state.nextKey };
      return msg.history.reduce((s, e) => addEvent(s, e), out);
    }
    case "state":
      return { ...state, view: msg.view, error: null };
    case "clock": {
      const { type: _t, ...clock } = msg;
      return { ...state, clock };
    }
    case "event":
      return addEvent(state, msg.event);
    case "error":
      return { ...state, error: msg.message };
  }
}

/** A live lap event as a row of the lap table, added once: the snapshot's history repeats laps the table already has. */
function addLap(state: RaceState, p: Record<string, unknown>): RaceState {
  const car = String(p.car), lap = Number(p.lap);
  const rows = state.laps[car] ?? [];
  if (rows.some((r) => r[0] === lap)) return state;
  const row: LapRow = [lap, Number(p.lap_time), p.compound as Compound, Number(p.age), typeof p.flags === "string" ? p.flags : ""];
  return { ...state, laps: { ...state.laps, [car]: [...rows, row].sort((a, b) => a[0] - b[0]) } };
}

function addEvent(state: RaceState, e: GameEvent): RaceState {
  if (e.type === "lap") return addLap(state, e.payload);
  if (e.type === "radio") {
    const line = { ...(e.payload as unknown as Omit<RadioLine, "tick">), tick: e.tick } as RadioLine;
    const requests = line.request ? [...state.requests.filter((r) => r.id !== line.id), line] : state.requests;
    return { ...state, radio: [...state.radio.filter((r) => r.id !== line.id), line].slice(-MAX_RADIO), requests };
  }
  if (e.type === "radio_request_closed") return { ...state, requests: state.requests.filter((r) => r.id !== (e.payload as { id: number }).id) };
  const d = describe(e, state.view);
  if (!d) return state;
  const messages = [{ key: state.nextKey, tick: e.tick, ...d }, ...state.messages].slice(0, MAX_MESSAGES);
  return { ...state, messages, nextKey: state.nextKey + 1 };
}
