export interface Chaos {
  on: boolean;
  values: Record<(typeof CHAOS_KEYS)[number]["key"], number>;
}

export const CHAOS_KEYS = [
  { key: "incident_rate", label: "Collisions and spins", hint: "How often cars touch, spin or crash." },
  { key: "reliability_rate", label: "Mechanical failures", hint: "How often a car breaks down." },
  { key: "first_lap_chaos", label: "Lap one carnage", hint: "How messy the start and the first lap are." },
  { key: "sc_response_bias", label: "Safety cars", hint: "How readily incidents bring out the safety car." },
] as const;

export const CHAOS_MIN = 0;
export const CHAOS_MAX = 3;
export const REALISTIC: Chaos["values"] = { incident_rate: 1, reliability_rate: 1, first_lap_chaos: 1, sc_response_bias: 1 };
export const MAYHEM: Chaos["values"] = { incident_rate: 2.5, reliability_rate: 2.5, first_lap_chaos: 2.5, sc_response_bias: 2 };

/** Whether the sliders sit exactly on a preset, so its button can show as chosen. */
export const matchesPreset = (values: Chaos["values"], preset: Chaos["values"]): boolean => CHAOS_KEYS.every(({ key }) => values[key] === preset[key]);

/** The multipliers the server takes, or an empty object when chaos mode is off (which is the realistic race). */
export const chaosRequest = (c: Chaos): Record<string, number> => (c.on ? { ...c.values } : {});

export function ChaosPanel({ chaos, onChange }: { chaos: Chaos; onChange: (c: Chaos) => void }) {
  return (
    <section className={`chaos ${chaos.on ? "on" : ""}`}>
      <label className="chaos-toggle">
        <input type="checkbox" checked={chaos.on} onChange={(e) => onChange({ ...chaos, on: e.target.checked })} />
        <span>
          <strong>Chaos mode</strong>
          <span className="muted"> Tweak how often things go wrong. 1.0x is the realistic rate.</span>
        </span>
      </label>
      {chaos.on && (
        <>
          <div className="chaos-presets">
            <button type="button" className={matchesPreset(chaos.values, REALISTIC) ? "chosen" : ""} aria-pressed={matchesPreset(chaos.values, REALISTIC)} onClick={() => onChange({ on: true, values: { ...REALISTIC } })}>Realistic</button>
            <button type="button" className={matchesPreset(chaos.values, MAYHEM) ? "chosen" : ""} aria-pressed={matchesPreset(chaos.values, MAYHEM)} onClick={() => onChange({ on: true, values: { ...MAYHEM } })}>Mayhem</button>
          </div>
          {CHAOS_KEYS.map(({ key, label, hint }) => (
            <label key={key} className="slider">
              <span>
                {label} <span className="muted small">{hint}</span>
              </span>
              <input
                type="range"
                min={CHAOS_MIN}
                max={CHAOS_MAX}
                step={0.25}
                value={chaos.values[key]}
                onChange={(e) => onChange({ on: true, values: { ...chaos.values, [key]: Number(e.target.value) } })}
              />
              <output>{chaos.values[key].toFixed(2)}x</output>
            </label>
          ))}
        </>
      )}
    </section>
  );
}
