/** The people of the pit wall in the scene: builds the crew, engineers, strategist and drivers from the content pack and the team the
 * player runs, and moves them each frame as the director says. Reads only the render model and its cues. */
import { Container } from "pixi.js";
import type { ModelStore } from "../../render/store";
import { Character } from "./Character";
import { lanePhase } from "../cars/lane";
import { Director, ROSTER } from "./director";
import { poseAt } from "./poses";
import { characterSpec } from "./spec";

interface Built {
  key: string;
  director: Director;
  chars: Map<string, Character>;
  mine: string[];
}

export class PeopleLayer {
  private built: Built | null = null;
  private store: ModelStore | null = null;
  private cursor = 0;
  /** Called when the player's car has stopped in its box and the work begins (the audio plays the wheel guns). */
  onStop: (() => void) | null = null;
  private stopped = new Set<string>(); // stops already started, by car and the time it entered the lane

  /** `lane` holds the crew on the pit lane, `wall` the people behind the pit wall (the wall hides their legs). */
  constructor(private lane: Container, private wall: Container) {
    lane.visible = wall.visible = false;
  }

  attach(store: ModelStore | null): void {
    this.store = store;
    this.cursor = store ? store.cueEnd : 0; // what happened before this screen existed is not replayed
    if (!store) this.clear();
  }

  private clear() {
    for (const c of [this.lane, this.wall]) c.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    this.built = null;
    this.lane.visible = this.wall.visible = false;
  }

  private build(store: ModelStore) {
    const m = store.model!;
    const first = m.cars.find((c) => c.id === m.mine[0]);
    if (!first) return;
    const r = store.resolver;
    const team = r.team(first.teamId);
    const crewIds = r.archetypeIds("crew");
    const stratIds = r.archetypeIds("strategist");
    const engIds = team.engineers?.length ? team.engineers : r.archetypeIds("engineer");
    const chars = new Map<string, Character>();
    let crewN = 0;
    for (const s of ROSTER) {
      let archetypeId: string | undefined;
      let kit = team.crew.kit;
      let helmet = team.crew.helmet;
      if (s.group === "crew") archetypeId = crewIds[crewN++ % Math.max(crewIds.length, 1)];
      else if (s.group === "engineer") archetypeId = engIds[s.id === "eng-1" ? 0 : 1] ?? engIds[0];
      else if (s.group === "strategist") archetypeId = stratIds[0] ?? engIds[1] ?? engIds[0];
      else {
        const car = m.mine[Number(s.id.slice(-1))];
        if (!car) continue;
        const d = r.driver(car);
        archetypeId = d.archetype;
        helmet = d.helmet.primary;
        kit = team.colours.primary;
      }
      const spec = characterSpec(r.archetype(archetypeId ?? ""), { kit, helmet, trim: team.colours.accent, facing: s.facing, seed: `${first.teamId}:${s.id}`, prop: s.prop });
      // the engineers and the strategist are dressed alike but darker than the crew, so the roles read at a glance
      if (s.group === "engineer" || s.group === "strategist") spec.kit = shade(spec.kit, 0.6);
      const ch = new Character({ ...spec, role: s.role });
      ch.root.position.set(s.x, s.y);
      (s.group === "crew" ? this.lane : this.wall).addChild(ch.root);
      chars.set(s.id, ch);
    }
    this.built = { key: `${store.version}:${first.teamId}:${m.mine.join(",")}`, director: new Director(m.mine), chars, mine: m.mine };
    this.lane.visible = this.wall.visible = true;
  }

  update(now: number): void {
    const store = this.store;
    if (!store?.model) return;
    const key = `${store.version}:${store.model.cars.find((c) => c.id === store.model!.mine[0])?.teamId}:${store.model.mine.join(",")}`;
    if (!this.built || this.built.key !== key) {
      this.clear();
      this.build(store);
      if (!this.built) return;
    }
    const b = this.built;
    const { cues, next } = store.cuesSince(this.cursor);
    this.cursor = next;
    for (const c of cues) b.director.onCue(c, now, c.type === "win" && !!c.car && b.mine.includes(c.car));
    // the work starts when the player's car has stopped in its box, which the time in the lane says
    const sim = store.simNow(now);
    for (const p of store.model.pitLane) {
      if (!b.mine.includes(p.car)) continue;
      const key = `${p.car}:${p.sinceT}`;
      if (!this.stopped.has(key) && lanePhase(sim - p.sinceT) === "stopped") {
        this.stopped.add(key);
        b.director.onStop(now);
        this.onStop?.();
      }
    }
    b.director.update(now);
    for (const s of ROSTER) {
      const ch = b.chars.get(s.id);
      if (!ch) continue;
      const vis = b.director.visible(s.id);
      ch.root.visible = vis;
      if (!vis) continue;
      const { clip, t } = b.director.clip(s.id, now);
      ch.apply(poseAt(clip, t, ROSTER.indexOf(s) * 0.37));
    }
  }
}

function shade(c: number, k: number): number {
  const r = Math.round(((c >> 16) & 255) * k), g = Math.round(((c >> 8) & 255) * k), b = Math.round((c & 255) * k);
  return (r << 16) | (g << 8) | b;
}
