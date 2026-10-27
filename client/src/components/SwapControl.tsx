import { useState } from "react";
import { SWAP_RULE, anchorOptions, parseAnchor, swapOffer, swapStatus } from "../swapUi";
import { useNames } from "../hooks";
import type { RaceApi } from "./Play";

/** Team order: ask the leading car to let the other one by, as soon as possible or around a named turn. Shown for a two-car team. */
export function SwapControl({ race }: { race: RaceApi }) {
  const { view, info } = race.state;
  const [when, setWhen] = useState("asap");
  if (!view || !info || info.human_cars.length < 2) return null;
  const offer = swapOffer(view, info.human_cars, info.swap_window_s);
  const pending = info.human_cars.map((id) => ({ id, swap: view.own[id]?.swap })).find((x) => x.swap);
  const names = useNames();
  const name = (id?: string) => (id ? names.driverShort(id) : "");
  const options = anchorOptions(info.corners);
  return (
    <section className="car-card swap">
      <h3>Team order</h3>
      {pending?.swap ? (
        <p>
          {name(pending.id)} → {name(pending.swap.with)}: <strong>{swapStatus(pending.swap)}</strong>{" "}
          <button onClick={() => race.cancelSwap(pending.id)}>Cancel</button>
        </p>
      ) : offer.ok ? (
        <>
          <p className="muted small">
            {name(offer.lead)} is ahead of {name(offer.rear)} by {offer.gap.toFixed(1)} s.
          </p>
          <div className="swap-row">
            <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When to swap">
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                const { anchor, turn } = parseAnchor(when);
                race.swapPositions(offer.lead, offer.rear, anchor, turn);
              }}
            >
              Swap {name(offer.lead)} / {name(offer.rear)}
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">Not available: {offer.reason} {SWAP_RULE(info.swap_window_s ?? 3)}</p>
      )}
    </section>
  );
}
