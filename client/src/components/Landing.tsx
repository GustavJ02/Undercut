import { useEffect, useRef } from "react";
import { loadSettings, saveSettings } from "../settings";
import { useSettings } from "../hooks";
import { AboutButton } from "./AboutButton";
import { HowToPlayButton } from "./HowToPlay";
import { LegalFooter } from "./LegalFooter";
import { PacksButton } from "./PacksButton";

/** The landing page, drawn over the wide shot of the pit wall. Entering it starts the setup; the camera moves in once the race is made. */
export function Landing({ onEnter }: { onEnter: () => void }) {
  const { skipIntro } = useSettings();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="landing">
      <p className="landing-kicker">Live race strategy</p>
      <h1>Undercut</h1>
      <p className="landing-tag">The whole race on the pit wall. Call the stops, read the gaps, and live with the safety car.</p>
      <button ref={button} className="primary landing-go" onClick={onEnter}>
        Enter the pit wall
      </button>
      <div className="landing-options">
        <label className="check">
          <input type="checkbox" checked={skipIntro} onChange={(e) => saveSettings({ ...loadSettings(), skipIntro: e.target.checked })} />
          Skip the intro
        </label>
        <PacksButton className="link" />
        <HowToPlayButton className="link" />
        <AboutButton className="link" />
      </div>
      <LegalFooter className="landing-legal" />
    </div>
  );
}
