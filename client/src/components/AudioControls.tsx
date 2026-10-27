import { useState } from "react";
import { BUSES, BUS_LABELS, type Bus } from "../audio/mixer";
import { useSettings } from "../hooks";
import { loadSettings, saveSettings } from "../settings";

/** A sound button for the header with a small mixer: master, one slider per category, and mute. */
export function AudioControls({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { audio } = useSettings();
  const [open, setOpenState] = useState(false);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const set = (patch: Partial<typeof audio>) => saveSettings({ ...loadSettings(), audio: { ...audio, ...patch } });
  const slider = (label: string, key: "master" | Bus) => (
    <label className="mix-row" key={key}>
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={audio[key]} aria-label={`${label} volume`} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <span className="audio-controls">
      <button className={audio.muted ? "" : "chosen"} aria-expanded={open} onClick={() => setOpen(!open)} title="Sound">
        {audio.muted ? "Sound off" : "Sound"}
      </button>
      {open && (
        <div className="mixer" role="group" aria-label="Sound mix">
          <label className="mix-row mix-mute">
            <input type="checkbox" checked={audio.muted} onChange={(e) => set({ muted: e.target.checked })} /> <span>Mute</span>
          </label>
          {slider("Master", "master")}
          {BUSES.map((b) => slider(BUS_LABELS[b], b))}
        </div>
      )}
    </span>
  );
}
