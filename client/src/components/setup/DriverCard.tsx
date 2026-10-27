import type { DriverIdentity, TeamIdentity } from "../../packs/types";

/** A driver bust, from the pack's helmet and team colours: a helmet with a visor over the shoulders in the team kit. */
export function DriverCard({ name, driver, team, selected }: { name: string; driver: DriverIdentity; team: TeamIdentity; selected?: boolean }) {
  const h = driver.helmet;
  return (
    <div className={`driver-card ${selected === false ? "off" : ""}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M6 100 C8 74 28 66 50 66 C72 66 92 74 94 100Z" fill={team.crew.kit} />
        <rect x="40" y="58" width="20" height="14" fill="#c58c63" />
        <circle cx="50" cy="38" r="24" fill={h.primary} />
        {h.pattern !== "solid" && <path d="M26 38 A24 24 0 0 1 74 38 L74 30 A24 24 0 0 0 26 30Z" fill={h.secondary} />}
        <rect x="30" y="34" width="40" height="14" rx="6" fill="#10131a" />
        <rect x="33" y="36" width="34" height="4" rx="2" fill="rgba(255,255,255,0.25)" />
      </svg>
      <div>
        <strong>{name}</strong>
        <span className="muted">#{driver.number}</span>
      </div>
    </div>
  );
}
