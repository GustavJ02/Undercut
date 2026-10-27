import { useState } from "react";
import { createPortal } from "react-dom";
import { RULE_TEXT } from "../rules";

/** A button that opens a one-screen explanation: the goal, the stop rule, and what the main panels show. */
export function HowToPlayButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        How to play
      </button>
      {open && createPortal(<HowToPlay onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="packs-backdrop" role="dialog" aria-modal="true" aria-label="How to play" onClick={onClose}>
      <div className="packs about" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <p>
          <strong>The goal:</strong> finish as high up as you can with your team's cars. You run the pit wall: the race plays out on its own,
          and you decide when each car stops and on which tyres, and when to swap them.
        </p>
        <p>
          <strong>The stop rule:</strong> {RULE_TEXT}
        </p>
        <ul className="how-list">
          <li><strong>Timing tower</strong> (left): the order, gaps, tyres and tyre age of every car. Your cars are marked.</li>
          <li><strong>Track map</strong> (middle): where everyone is, and the weather with its forecast.</li>
          <li><strong>Pit and orders</strong> (right): call a stop for each car, ask a driver to let the other by, and read the radio.</li>
          <li><strong>Strategy</strong> (press the right arrow, or the button on top): lap times, tyre wear and where a stop would put you.</li>
        </ul>
        <p className="muted small">The tyre wear you see is an estimate: the real state of the tyres, and of the other teams' plans, stays hidden. After the race the debrief tells luck from skill.</p>
        <div className="swap-row">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
