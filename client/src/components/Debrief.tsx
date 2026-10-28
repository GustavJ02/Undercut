import { useEffect, useState } from "react";
import { getDebrief, getGameDebrief, startDebrief } from "../api";
import { VERDICT_TEXT, barScale, fixed, headlines, largeButNoisy, meaningful, place, signed, verdict } from "../debrief";
import { RULE_TEXT } from "../rules";
import type { DebriefDecision, DebriefOption, DebriefReport, DebriefStatus } from "../types";

const surname = (names: Record<string, string>, id: string) => (names[id] ?? id).split(" ").slice(-1)[0];

/** The page after the race: what the calls were worth, what was luck, and decision by decision what else could have been done. */
export function Debrief({ roomId, names, onClose, onShowLap, player }: { roomId: string; names: Record<string, string>; onClose: () => void; onShowLap: (lap: number, car: string) => void; player?: { team: string; seat: string } }) {
  const [state, setState] = useState<DebriefStatus>({ status: "not started" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const s = player ? await getGameDebrief(roomId, player.team, player.seat) : await getDebrief(roomId);
        if (stop) return;
        setState(s);
        if (s.status === "running" || s.status === "not started") timer = window.setTimeout(poll, 1000);
      } catch (e) {
        setError(String(e));
      }
    };
    (player ? Promise.resolve() : startDebrief(roomId)).then(poll).catch((e) => setError(String(e)));
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [roomId, player?.team, player?.seat]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = (state.status === "running" || state.status === "not started") && !error;
  return (
    <div className="result debrief">
      <div className="debrief-head">
        <button onClick={onClose} title="Back to the final classification">◂ Final classification</button>
        <h2>Debrief</h2>
      </div>
      {error && <p className="error">{error}</p>}
      {state.status === "error" && <p className="error">The debrief failed: {state.error}</p>}
      {running && <Progress state={state} />}
      {state.status === "done" && <Report report={state.report} names={names} onShowLap={onShowLap} multiplayer={!!player} />}
    </div>
  );
}

function Progress({ state }: { state: DebriefStatus }) {
  const [done, total] = state.status === "running" ? state.progress : [0, 0];
  return (
    <div className="progress" role="status">
      <p className="muted">Checking your calls against alternative futures…{total > 0 ? ` ${done} of ${total}` : " preparing"}</p>
      <progress max={Math.max(total, 1)} value={done} aria-label="Replay progress" />
    </div>
  );
}

function Report({ report, names, onShowLap, multiplayer }: { report: DebriefReport; names: Record<string, string>; onShowLap: (lap: number, car: string) => void; multiplayer: boolean }) {
  const s = report.summary;
  const v = verdict(s);
  const { miss, costly } = headlines(report);
  const headline = (d: DebriefDecision) => `lap ${d.lap}, ${surname(names, d.car)}, ${d.call.charAt(0).toLowerCase()}${d.call.slice(1)}`;
  return (
    <div className="report">
      <section className="summary-block">
        <p className="score" title="50 means as good as the AI would have been with your cars">
          Strategist score <strong>{Math.round(s.score)}</strong> / 100 <span className="muted small">({Math.round(s.score_low)} to {Math.round(s.score_high)} within one standard error; 50 = as good as the AI)</span>
        </p>
        <p className="verdict">{v.skill}</p>
        <p className="verdict">{v.luck}</p>
        <table className="arith">
          <thead>
            <tr><th /><th /><th className="num">Points</th><th className="num">Mean position</th></tr>
          </thead>
          <tbody>
            <tr><td /><td>Baseline: the default strategy</td><td className="num">{s.baseline_points.toFixed(1)}</td><td className="num">{place(s.baseline_position)}</td></tr>
            <tr>
              <td className="op">+</td><td>Skill: your calls</td>
              <td className="num">{signed(s.skill_points)} ± {fixed(s.skill_points_se)}</td><td className="num">{signed(s.skill_places)} places</td>
            </tr>
            <tr className="sum"><td className="op">=</td><td>Expected from your calls</td><td className="num">{s.expected_points.toFixed(1)}</td><td className="num">{place(s.expected_position)}</td></tr>
            <tr><td className="op">+</td><td>Luck</td><td className="num">{signed(s.luck_points)}</td><td className="num" /></tr>
            <tr className="sum total"><td className="op">=</td><td>What you actually scored</td><td className="num">{s.actual_points}</td><td className="num">{place(s.actual_position)}</td></tr>
          </tbody>
        </table>
        {report.penalties.length > 0 && (
          <p className="penalty">
            Penalties in the race, which the expected score does not include but the strategist score does: {report.penalties.map((p) => `${surname(names, p.car)}: ${p.reason} (${p.effect})`).join("; ")}. {RULE_TEXT}
          </p>
        )}
        {miss && (
          <p className="headline">
            <strong>Biggest miss:</strong> {headline(miss)}: −{fixed(miss.miss_points)} pts, −{fixed(miss.miss_places)} places against the best option.
          </p>
        )}
        {costly && (
          <p className="headline">
            <strong>Costliest decision in the chain:</strong> {headline(costly)}: {signed(costly.contribution_points)} pts, {signed(costly.contribution_places)} places.
          </p>
        )}
        {!miss && <p className="muted">No decision had a miss that is clearly more than noise.</p>}
        <table className="drivers">
          <thead>
            <tr><th>Driver</th><th className="num">Finished</th><th className="num">Expected finish</th><th className="num">Points</th><th className="num">Expected points</th></tr>
          </thead>
          <tbody>
            {s.drivers.map((d) => (
              <tr key={d.car}>
                <td><span className="drv">{d.car}</span> {surname(names, d.car)}</td>
                <td className="num">P{d.actual_position}</td><td className="num">{place(d.expected_position)}</td>
                <td className="num">{d.actual_points}</td><td className="num">{d.expected_points.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h3>Your decisions</h3>
      <p className="muted">
        The contributions add up to your skill. A contribution is the value with your calls up to and including this one, less the value up to the one before, so it also holds
        what the default strategy would have done in between. A miss is the best alternative's advantage at that moment: misses do not add up and are not part of the sum above.
      </p>
      {report.decisions.length === 0 && <p className="muted">No decisions to review.</p>}
      {report.decisions.map((d) => (
        <DecisionRow key={d.index} d={d} name={surname(names, d.car)} onShowLap={onShowLap} />
      ))}

      <details className="explain">
        <summary>How this is scored</summary>
        <p>
          Points are the championship points of the race: 25, 18, 15, 12, 10, 8, 6, 4, 2 and 1 for the top ten. A "future" is the same race with
          fresh luck from the moment of a decision on: safety cars, failures, weather and pace noise. Every option of every decision is played
          on the same {report.futures} futures, so two options are compared future by future.
        </p>
        <p>
          The ± is the standard error of that difference: if the real difference were zero, it would land beyond twice the ± only about one time in twenty.
          An option is called better or worse only beyond that. The default strategy takes over after each decision.
        </p>
        <p>
          A normal swing is how far the same calls scatter from their average points across futures, here about ±{s.expected_points_sd.toFixed(0)} points
          and usually around ±5: one safety car or one failure moves a team by that much. Luck is what the real race gave beyond your calls' average,
          and one race only shows one future.{multiplayer ? " In a multiplayer race luck also includes what the other players did." : ""}
        </p>
        <p>
          The strategist score puts your skill (places and points gained against the default strategy with the same cars) on a scale from 0 to 100:
          50 is exactly as good as the AI, three places gained is about 89 and three lost about 11.
        </p>
      </details>
    </div>
  );
}

function DecisionRow({ d, name, onShowLap }: { d: DebriefDecision; name: string; onShowLap: (lap: number, car: string) => void }) {
  const open = meaningful(d);
  return (
    <details className={`decision ${open ? "notable" : ""}`} open={open}>
      <summary>
        <span className="d-lap">Lap {d.lap}</span>
        <span className="d-car">{name}</span>
        <span className="d-call">{d.call}</span>
        <span className={`d-verdict ${d.significant ? "d-flag" : "muted"}`}>{d.significant ? "better was available" : "no meaningful difference"}</span>
      </summary>
      <div className="d-body">
        <OptionsTable options={d.options} />
        <p className="small">
          Contribution to your skill: <strong>{signed(d.contribution_points)} ± {fixed(d.contribution_points_se)} pts</strong>, {signed(d.contribution_places)} places
          {largeButNoisy(d) ? " (large, but within the noise)" : ""}.{" "}
          {d.miss_points > 0 ? `Miss: ${fixed(d.miss_points)} pts, ${fixed(d.miss_places)} places against the best option.` : "No option beat the taken one."}
        </p>
        <button className="link-lap" onClick={() => onShowLap(d.lap, d.car)}>Show lap {d.lap} in the Strategy chart ▸</button>
      </div>
    </details>
  );
}

const BAR_W = 320, BAR_H = 28;

function OptionsTable({ options }: { options: DebriefOption[] }) {
  const { hi } = barScale(options);
  const x = (v: number) => BAR_W / 2 + (v / hi) * (BAR_W / 2 - 6);
  return (
    <table className="options">
      <thead>
        <tr>
          <th>Option</th><th className="num">Points vs taken</th><th className="num">±</th><th className="num">Places</th><th>Verdict</th>
          <th className="barhead">Worse ◂ taken ▸ better</th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => (
          <tr key={o.id} className={`opt opt-${o.verdict}${o.taken ? " taken" : ""}`}>
            <td className="opt-name">{o.name}{o.default && <span className="muted small"> · default strategy</span>}</td>
            <td className="num">{o.taken ? "taken" : signed(o.delta_points)}</td>
            <td className="num">{o.taken ? "" : fixed(o.delta_points_se)}</td>
            <td className="num">{o.taken ? "" : signed(o.places)}</td>
            <td>{o.taken ? "" : VERDICT_TEXT[o.verdict]}</td>
            <td className="bars">
              <svg width={BAR_W} height={BAR_H} viewBox={`0 0 ${BAR_W} ${BAR_H}`} role="img"
                   aria-label={o.taken ? `${o.name}: the taken option, the zero line` : `${o.name}: ${signed(o.delta_points)} points, ${VERDICT_TEXT[o.verdict]}`}>
                <line className="zero" x1={BAR_W / 2} x2={BAR_W / 2} y1={0} y2={BAR_H} />
                {!o.taken && (
                  <>
                    <rect className="bar" x={Math.min(x(0), x(o.delta_points))} y={9} width={Math.abs(x(o.delta_points) - x(0))} height={10} />
                    <line className="whisker" x1={x(o.delta_points - 2 * o.delta_points_se)} x2={x(o.delta_points + 2 * o.delta_points_se)} y1={BAR_H / 2} y2={BAR_H / 2} />
                    <line className="whisker" x1={x(o.delta_points - 2 * o.delta_points_se)} x2={x(o.delta_points - 2 * o.delta_points_se)} y1={9} y2={19} />
                    <line className="whisker" x1={x(o.delta_points + 2 * o.delta_points_se)} x2={x(o.delta_points + 2 * o.delta_points_se)} y1={9} y2={19} />
                  </>
                )}
              </svg>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
