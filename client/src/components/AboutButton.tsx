import { useState } from "react";
import { createPortal } from "react-dom";
import { CONTACT_EMAIL, REPO_URL } from "../legal";

/** A button that opens the About page: why the game exists, how it is made, and where the source is. */
export function AboutButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        About
      </button>
      {open && createPortal(<About onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="packs-backdrop" role="dialog" aria-modal="true" aria-label="About Undercut" onClick={onClose}>
      <div className="packs about" onClick={(e) => e.stopPropagation()}>
        <h2>About Undercut</h2>
        <p>
          Undercut is a race strategy game about the part of motorsport that is mostly numbers and nerve: when to stop, on which tyres, and
          whether to trust what the timing screen says. You run the pit wall, alone or with friends who each run a team, and every race
          can be replayed exactly.
        </p>
        <p>
          It started as a way to explore strategy decisions without needing a real grid. The tyre cliff and the pace of the other cars are
          hidden, so you read them from noisy estimates like a real strategist. After the race the debrief replays your calls against other
          possible futures and tells luck and skill apart.
        </p>
        <p>
          {/* TODO(owner): add the sentence about the circuit outlines once their licensing is decided. */}
          Everything in the base game is invented: teams, drivers, sounds and graphics. Content packs can change how it looks and sounds,
          and never how the race plays.
        </p>
        <p>
          The code is free software under the GNU Affero General Public License v3.0. The source, the issue tracker and the modding guide are
          on <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>.
        </p>
        <p className="muted small">
          Questions, bug reports or rights-holder requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> ·{" "}
          <a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a>
        </p>
        <div className="swap-row">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
