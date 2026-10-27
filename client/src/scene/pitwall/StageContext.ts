import { createContext, useContext } from "react";
import type { ModelStore } from "../../render/store";
import type { PoseName } from "./camera";

export interface StageApi {
  /** Move the camera to a pose; `ms` 0 jumps there. Calling it with the pose already targeted does nothing. */
  setPose(name: PoseName, ms: number): void;
  /** Drop the camera so the scenery is a thin band above larger monitors (1), or raise it back to the full wall (0). */
  setDrop(drop: 0 | 1, ms: number): void;
  /** Finish a move in progress at once. */
  skip(): void;
  /** Show the people of this race's team (null removes them). Their animation follows the store's cues. */
  attach(store: ModelStore | null): void;
  /** Which bezels the desk shows. */
  setMonitors(mode: "race" | "briefing" | "none"): void;
}

export const StageContext = createContext<StageApi | null>(null);

/** The stage's controls, or null in plain mode, where there is no stage. */
export const useStage = (): StageApi | null => useContext(StageContext);
