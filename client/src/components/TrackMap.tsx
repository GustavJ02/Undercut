import { useEffect, useRef, useState } from "react";
import { newTrack, position, update, type Track } from "../smooth";
import { buildOutline, finishLine, outlinePath, outlinePoint } from "../track";
import { TRACKS } from "../circuits";
import { useNames } from "../hooks";
import type { Corner, View } from "../types";

// The circuit outline when we have one (private use only, design open question 7), else a schematic oval.
const W = 320;
const H = 190;

export function trackPoint(frac: number): { x: number; y: number } {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return { x: W / 2 + 130 * Math.cos(a), y: H / 2 + 62 * Math.sin(a) };
}

const OUTLINES = Object.fromEntries(Object.entries(TRACKS).map(([name, unit]) => [name, buildOutline(unit)]));

export function TrackMap({ view, humanCars, paused, circuit, corners }: { view: View; humanCars: string[]; paused: boolean; circuit?: string; corners?: Corner[] }) {
  const names = useNames();
  const outline = circuit ? OUTLINES[circuit] : undefined;
  const track = useRef<Track>(newTrack());
  const [, frame] = useState(0);
  useEffect(() => {
    track.current = update(track.current, Object.fromEntries(view.cars.map((c) => [c.id, c.lap_frac])), performance.now());
  }, [view]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frame((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const now = performance.now();
  return (
    <svg className="map" viewBox={`0 0 ${outline?.width ?? W} ${outline?.height ?? H}`} role="img" aria-label="Track map">
      {outline ? (
        <>
          <path d={outlinePath(outline)} className="track" />
          <path d={outlinePath(outline)} className="track-line" />
          <line {...finishLine(outline)} className="finish" />
        </>
      ) : (
        <>
          <ellipse cx={W / 2} cy={H / 2} rx={130} ry={62} className="track" />
          <line x1={W / 2} y1={H / 2 - 74} x2={W / 2} y2={H / 2 - 50} className="finish" />
        </>
      )}
      {outline &&
        corners?.map((c) => {
          const p = outlinePoint(outline, c.frac);
          return (
            <text key={c.n} x={p.x} y={p.y - 7} className="corner-label">
              {c.n}
            </text>
          );
        })}
      {view.cars
        .filter((c) => c.status !== "RETIRED" && c.status !== "FINISHED")
        .map((c) => {
          const frac = position(track.current, c.id, now, paused);
          const p = outline ? outlinePoint(outline, frac) : trackPoint(frac);
          const mine = humanCars.includes(c.id);
          return (
            <g key={c.id}>
              <circle cx={p.x} cy={p.y} r={mine ? 6 : 4} className={mine ? "dot mine" : "dot"} />
              {mine && (
                <text x={p.x + 8} y={p.y - 6} className="dot-label">
                  {names.driverShort(c.id)}
                </text>
              )}
            </g>
          );
        })}
      {view.safety_car && (() => {
        const p = outline ? outlinePoint(outline, view.safety_car.lap_frac) : trackPoint(view.safety_car.lap_frac);
        return (
          <g>
            <rect x={p.x - 10} y={p.y - 6} width={20} height={12} rx={3} className="sc-mark" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="sc-text">SC</text>
          </g>
        );
      })()}
    </svg>
  );
}
