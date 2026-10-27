/** A `RaceApi`-shaped object fed by the synthetic race, so the real screens can be shown without a server (`/?replay&screen=pitwall`). */
import { useEffect, useMemo, useReducer } from "react";
import type { RaceApi } from "../components/Play";
import { emptyResolver } from "../packs/browser";
import { registry } from "../packs/registry";
import { usePacks } from "../hooks";
import { loadSettings, saveSettings } from "../settings";
import { ModelStore, type Incoming } from "../render/store";
import { synth } from "../render/synth";
import { initialState, reduce } from "../state";

const params = new URLSearchParams(location.search);

export function useSynthRace(): RaceApi {
  const [state, dispatch] = useReducer(reduce, initialState);
  const store = useMemo(() => new ModelStore(emptyResolver()), []);
  usePacks((r) => store.setResolver(r, performance.now()));
  useEffect(() => {
    let stop = false;
    void registry.ensure().then(async () => {
      if (params.get("pack")) saveSettings({ ...loadSettings(), pack: params.get("pack") }); // `&pack=neon-harbour` shows a mod
      const resolver = registry.resolver();
      store.setResolver(resolver, performance.now());
      const pack = await (await fetch("/packs/base-fictional/manifest.json")).json();
      const teams = Object.keys(pack.teams);
      const carIds = Object.keys(pack.drivers).map((id, i) => ({ id, team: teams[Math.floor(i / 2)] }));
      const laps = Number(params.get("laps") ?? 40);
      const gen = synth({ seed: Number(params.get("seed") ?? 3), carIds, laps, lapS: 60, human: [carIds[2].id, carIds[3].id], safetyCar: params.get("nosc") ? undefined : (params.get("sc")?.split(",").map(Number) as [number, number] | undefined) ?? [140, 200], retire: { [carIds[9].id]: 90, ...(params.get("retire") ? { [carIds[3].id]: Number(params.get("retire")) } : {}) }, pitLaps: laps < 10 ? [1] : [2, 5], rain: params.get("rain") ? [Number(params.get("rain")), Number(params.get("rain")) + 120] : undefined, redFlag: params.get("red") ? [Number(params.get("red")), Number(params.get("red")) + 40] : undefined, slow: params.get("blue") ? carIds[5].id : undefined, leader: params.get("win") ? carIds[2].id : undefined });
      const speed = Number(params.get("speed") ?? 1);
      let simT = Number(params.get("t0") ?? 0); // `&t0=SECONDS` starts the replay that far into the race
      let last = performance.now();
      let held: IteratorResult<Incoming> | null = null;
      const pump = () => {
        if (stop) return;
        const now = performance.now();
        simT += ((now - last) / 1000) * speed;
        last = now;
        for (;;) {
          const n: IteratorResult<Incoming> = held ?? gen.next();
          held = null;
          if (n.done) return;
          if (n.value.type === "state" && n.value.view.time_s > simT) {
            held = n;
            break;
          }
          dispatch(n.value as never);
          store.push(n.value, performance.now());
        }
        requestAnimationFrame(pump);
      };
      pump();
    });
    return () => {
      stop = true;
    };
  }, [store]);

  const noop = () => undefined;
  return { state, store, connected: true, setStartTyres: noop, callBox: noop, cancelBox: noop, start: noop, pause: noop, resume: noop, setSpeed: noop } as unknown as RaceApi;
}
