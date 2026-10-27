import type { ReactNode } from "react";
import { DROP, MONITORS, type MonitorName } from "../scene/pitwall/layout";

/** A screen on the pit-wall desk: a DOM box at the rectangle the art leaves for it (`layout.ts`). It fades in as the camera arrives. */
export function Monitor({ name, children, className = "", inert = false }: { name: MonitorName; children: ReactNode; className?: string; inert?: boolean }) {
  const r = MONITORS[name];
  return (
    <section className={`monitor monitor-${name} ${className}`} style={{ left: r.x, top: r.y, width: r.w, height: name === "briefing" ? r.h : `calc(${r.h}px + var(--drop, 0) * ${DROP}px)` }} {...(inert ? ({ inert: "" } as object) : {})}>
      <div className="monitor-screen">{children}</div>
    </section>
  );
}
