import { useEffect, useRef, useState } from "react";
import type { RaceApi } from "./Play";

const NOTE_MS = 6000;

/** Multiplayer speed: a small box under the speed buttons. A request to go faster is put to every player; going slower is immediate, and
 * is only announced. Shows who is asked, who is still being waited for, and for a few seconds how the last request ended. */
export function SpeedVoteBox({ race }: { race: RaceApi }) {
  const clock = race.state.clock;
  const vote = clock?.vote ?? null;
  const note = clock?.vote_note;
  const seen = useRef(note?.id ?? 0); // what was said before this screen opened is not news
  const timer = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState("");
  // The clock message makes a new `note` object every time, so this runs on the id: a cleanup tied to the object would cancel the timer
  // at the next clock message and the text would stay up for good.
  useEffect(() => {
    if (!note || note.id === seen.current) return;
    seen.current = note.id;
    setShown(note.text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(""), NOTE_MS);
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!vote && !shown) return null;
  const asked = !!vote && vote.waiting.includes(race.team) && vote.by !== race.team;
  const others = vote ? vote.waiting_names.filter((_, i) => vote.waiting[i] !== race.team) : [];
  return (
    <div className="votebox" role="status" aria-live="polite">
      {vote ? (
        <>
          <p>
            {vote.by === race.team ? `You want to increase speed to ${vote.to}x` : `${vote.by_name} wants to increase speed to ${vote.to}x`}
            {asked && (
              <span className="vote-buttons">
                <button type="button" className="yes" aria-label="Agree to the speed increase" title="Agree" onClick={() => race.voteSpeed("yes")}>✓</button>
                <button type="button" className="no" aria-label="Refuse the speed increase" title="Refuse" onClick={() => race.voteSpeed("no")}>✕</button>
              </span>
            )}
          </p>
          {others.length > 0 && <p className="muted small">Awaiting response from {others.join(", ")}</p>}
        </>
      ) : (
        <p>{shown}</p>
      )}
    </div>
  );
}
