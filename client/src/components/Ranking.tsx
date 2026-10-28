import { useEffect, useState } from "react";
import { getRanking } from "../api";
import { useNames } from "../hooks";
import type { RankingStatus } from "../types";

/** The strategists of a finished multiplayer game, best first: a score out of 100 from each player's own calls, with the best one named
 * the winner. The player's own row opens their detailed debrief. */
export function Ranking({ code, team, onDetail }: { code: string; team: string; onDetail: () => void }) {
  const names = useNames();
  const [state, setState] = useState<RankingStatus>({ status: "not started" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const s = await getRanking(code);
        if (stop) return;
        setState(s);
        if (s.status === "running" || s.status === "not started") timer = window.setTimeout(poll, 1000);
      } catch (e) {
        if (!stop) setError(String(e));
      }
    };
    void poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [code]);

  const winner = state.status === "done" ? state.ranking.find((r) => r.team === state.winner) : undefined;
  return (
    <section className="ranking" aria-label="Strategist ranking">
      <h3>Strategists</h3>
      {error && <p className="error">{error}</p>}
      {state.status === "error" && <p className="error">The ranking failed: {state.error}</p>}
      {(state.status === "running" || state.status === "not started") && !error && (
        <p className="muted" role="status">
          Scoring the strategists{state.status === "running" && state.progress[1] > 0 ? `: ${state.progress[0]} of ${state.progress[1]}` : "…"}
        </p>
      )}
      {state.status === "done" && (
        <>
          {winner && <p className="winner">Best strategist: <strong>{winner.name}</strong> with {names.team(winner.team)}, {Math.round(winner.score)} / 100</p>}
          <table className="results ranking-table">
            <thead>
              <tr><th>#</th><th>Strategist</th><th>Team</th><th>Score</th><th title="Places gained against the default strategy with the same cars">Places vs AI</th><th>Finished</th><th /></tr>
            </thead>
            <tbody>
              {state.ranking.map((r, i) => (
                <tr key={r.team} className={r.team === team ? "mine" : ""}>
                  <td>{i + 1}</td>
                  <td><strong>{r.name}</strong></td>
                  <td>{names.team(r.team)}</td>
                  <td className="key" title={`${Math.round(r.score_low)} to ${Math.round(r.score_high)} within one standard error`}>
                    <span className="scorebar" style={{ width: `${r.score}%` }} />
                    {Math.round(r.score)}
                  </td>
                  <td>{r.skill_places >= 0 ? "+" : "−"}{Math.abs(r.skill_places).toFixed(1)}</td>
                  <td>{r.cars.map((c) => names.driverShort(c)).join(", ")}: P{r.actual_position.toFixed(1)}</td>
                  <td>{r.team === team && <button className="primary" onClick={onDetail}>Detailed debrief</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Score: 50 is as good as the AI would have been with the same cars, from each player's own calls only.</p>
        </>
      )}
    </section>
  );
}
