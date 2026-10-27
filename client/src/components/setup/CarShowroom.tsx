import { useEffect, useRef, useState } from "react";
import { BODY, PARTS, PATTERN_SHAPES, type Shape, type Slot } from "../../scene/livery";
import type { Colours, Pattern } from "../../packs/types";
import { usePrefersReducedMotion } from "../../hooks";

export interface Look {
  colours: Colours;
  pattern: Pattern;
  helmet: string;
}

/** The car on a turntable. It is a procedural model built here from boxes and cones, styled from the pack's livery (the fictional colours and
 * pattern), so it resembles no real car. Without WebGL, or in a test, it is the flat side view drawn from the same livery data. */
export function CarShowroom({ look }: { look: Look }) {
  const host = useRef<HTMLDivElement>(null);
  const apply = useRef<((l: Look) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    import("./car3d")
      .then(({ mountCar }) => {
        if (dead || !host.current) return;
        try {
          const m = mountCar(host.current, look, reduced);
          apply.current = m.setLook;
          cleanup = m.dispose;
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      dead = true;
      apply.current = null;
      cleanup();
    };
    // the model is mounted once; later looks go through `apply`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  useEffect(() => apply.current?.(look), [look]);

  if (failed) return <FlatCar look={look} />;
  return <div className="showroom" ref={host} aria-label="A model of the car, drag to turn it" />;
}

/** The flat side view, from the same shapes as the track-map car. */
export function FlatCar({ look }: { look: Look }) {
  const colour = (s: Slot) => ({ primary: look.colours.primary, secondary: look.colours.secondary, accent: look.colours.accent, dark: "#14171d", helmet: look.helmet })[s];
  const shape = (s: Shape, i: number) =>
    s.kind === "circle" ? <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={colour(s.slot)} /> : <polygon key={i} points={s.pts.map((p) => p.join(",")).join(" ")} fill={colour(s.slot)} />;
  return (
    <div className="showroom flat">
      <svg viewBox="-0.6 -0.35 1.2 0.7" role="img" aria-label="Side view of the car">
        {PARTS.map(shape)}
        <polygon points={BODY.map((p) => p.join(",")).join(" ")} fill={look.colours.primary} />
        {PATTERN_SHAPES[look.pattern].map(shape)}
      </svg>
    </div>
  );
}
