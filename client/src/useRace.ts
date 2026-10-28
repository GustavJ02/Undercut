import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { audio } from "./audio/instance";
import { socketUrl } from "./api";
import { randomHold, startSeq, totalS } from "./startSequence";
import { usePacks } from "./hooks";
import { emptyResolver } from "./packs/browser";
import { reportDrift } from "./render/drift";
import { ModelStore, type Incoming } from "./render/store";
import { driverSurname } from "./packs/identity";
import { initialState, reduce, setSurnames } from "./state";
import type { Compound, ServerMessage } from "./types";

/** Connects to a race room and keeps its visible state. A dropped connection reconnects and gets a fresh snapshot. */
export function useRace(roomId: string, team: string, seat?: string) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState(false);
  const [starting, setStarting] = useState(false);
  const startTimer = useRef<number | undefined>(undefined);
  const ws = useRef<WebSocket | null>(null);
  const queue = useRef<ServerMessage[]>([]);
  const store = useRef<ModelStore>(null as unknown as ModelStore);
  store.current ??= new ModelStore(emptyResolver());

  useEffect(() => () => { window.clearTimeout(startTimer.current); startSeq.end(); }, []);

  // the presentation layer's identities: names, colours and numbers come from the content pack, by id
  usePacks((r) => {
    store.current.setResolver(r, performance.now());
    setSurnames((id) => driverSurname(id, r));
  });

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    const open = () => {
      const sock = new WebSocket(socketUrl(roomId, team, seat));
      ws.current = sock;
      sock.onopen = () => setConnected(true);
      // at 10x many messages arrive per frame: render once per frame with all of them, not once per message
      sock.onmessage = (m) => {
        queue.current.push(JSON.parse(m.data) as ServerMessage);
        if (queue.current.length === 1) {
          requestAnimationFrame(() => {
            const batch = queue.current;
            queue.current = [];
            batch.forEach((msg) => {
              dispatch(msg);
              reportDrift(msg);
              store.current.push(msg as unknown as Incoming, performance.now());
            });
          });
        }
      };
      sock.onclose = (e) => {
        setConnected(false);
        if (e.code === 4403) { closed = true; setDenied(true); return; } // a wrong or old seat: retrying cannot help
        if (!closed) retry = window.setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      ws.current?.close();
    };
  }, [roomId, team, seat]);

  const send = useCallback((msg: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg)), []);
  return {
    state,
    store: store.current,
    connected,
    denied,
    team,
    seat,
    setStartTyres: (car: string, compound: Compound) => send({ type: "action", kind: "SetStartTyres", car, compound }),
    callBox: (car: string, compound: Compound) => send({ type: "action", kind: "CallBox", car, compound }),
    swapPositions: (car: string, withCar: string, anchor: "asap" | "before" | "after", turn?: number) =>
      send({ type: "action", kind: "SwapPositions", car, with_car: withCar, anchor, ...(anchor === "asap" || turn === undefined ? {} : { turn }) }),
    cancelSwap: (car: string) => send({ type: "action", kind: "CancelSwap", car }),
    askRadio: (car: string, topic: string) => send({ type: "radio", op: "ask", car, topic }),
    answerRadio: (id: number, answer: "yes" | "no") => send({ type: "radio", op: "reply", id, answer }),
    boxOpposite: (car: string, target: string, compound: Compound) => send({ type: "action", kind: "BoxOpposite", car, target, compound }),
    cancelBox: (car: string) => send({ type: "action", kind: "CancelBox", car }),
    starting,
    /** Lights out for real: five lights on the gantry one by one with a beep each, a held pause, and the race starts as they go out. */
    voteSpeed: (answer: "yes" | "no") => send({ type: "control", op: "vote", answer }),
    start: () => {
      if (startTimer.current !== undefined) return;
      audio.unlock();
      startSeq.begin();
      audio.startLights();
      setStarting(true);
      startTimer.current = window.setTimeout(() => {
        send({ type: "control", op: "start" });
        startTimer.current = undefined;
        setStarting(false);
        window.setTimeout(() => startSeq.end(), 2000);
      }, totalS(randomHold(Math.random())) * 1000);
    },
    pause: () => send({ type: "control", op: "pause" }),
    resume: () => send({ type: "control", op: "resume" }),
    setSpeed: (value: number) => send({ type: "control", op: "speed", value }),
  };
}
