"use client";

import { useActionState, useState } from "react";
import { createBotGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export interface BotOption {
  id: string;
  username: string;
  description: string | null;
  /** Node budget, when the bot is bounded that way. */
  maxNodes: number | null;
  /** Percentage of turns it plays the best move it found. */
  accuracy: number | null;
  /** Which slice of the ranked list a slip lands in, as percentages. */
  poolFrom: number | null;
  poolTo: number | null;
  /** Whether those alternatives include moves that lose outright. */
  allowLosing: boolean;
}

/**
 * Start a game against the engine.
 *
 * The wait is stated up front rather than discovered. It is honest about being
 * an estimate: the engine runs on the player's own machine, so a phone takes
 * several times longer than a desktop for the same search — but because a bot
 * is bounded by node count rather than seconds, the *move* is identical either
 * way. Only the waiting differs.
 */
export default function NewBotGameForm({ bots }: { bots: BotOption[] }) {
  const [state, formAction, pending] = useActionState(createBotGameAction, initial);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");

  const chosen = bots.find((b) => b.id === botId) ?? bots[0];

  if (bots.length === 0) return null;

  return (
    <form action={formAction} className="panel">
      <h2>Play the engine</h2>

      <div className="field">
        <label htmlFor="bot_id">Opponent</label>
        <select
          id="bot_id"
          name="bot_id"
          value={botId}
          onChange={(e) => setBotId(e.target.value)}
        >
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.username}
            </option>
          ))}
        </select>
        {chosen?.description && <p className="hint">{chosen.description}</p>}
      </div>

      <div className="field">
        <label htmlFor="bot_move_seconds">Time control</label>
        <select id="bot_move_seconds" name="move_seconds" defaultValue="259200">
          <option value="86400">1 day per move</option>
          <option value="259200">3 days per move</option>
          <option value="604800">7 days per move</option>
          <option value="300">5 minutes per move (testing)</option>
        </select>
      </div>

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Play"}
        </button>
      </div>

      {/* Both dials, shown rather than hidden behind a name: how hard it
          looks, and how well it chooses among what it found. */}
      {chosen && (
        <div className="botdials">
          <Dial
            label="Thinking"
            value={describeThinking(chosen.maxNodes)}
            detail={chosen.maxNodes ? `${chosen.maxNodes.toLocaleString()} positions` : ""}
          />
          <Dial
            label="Accuracy"
            value={chosen.accuracy == null ? "—" : `${chosen.accuracy}%`}
            detail={describeAccuracy(chosen)}
          />
        </div>
      )}

      {chosen && (
        <p className="hint" style={{ marginTop: 12 }}>
          {describeWait(chosen)} The engine runs in this browser tab, so a
          slower device waits longer — but plays the same opponent.
        </p>
      )}

      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

/**
 * A rough wait, from the node budget.
 *
 * Interpolated from times measured against this build rather than a flat
 * nodes-per-second rate: a deeper search is slower *per node*, so a rate fitted
 * to small budgets badly underestimates large ones. 200,000 nodes takes about
 * fifteen seconds, not the eight a linear model predicts.
 *
 * Deliberately vague in the wording — this is a desktop figure, and quoting a
 * precise number for hardware we know nothing about would be false precision.
 */
const OBSERVED: [nodes: number, seconds: number][] = [
  [10_000, 0.5],
  [20_000, 0.7],
  [50_000, 1.7],
  [100_000, 5.4],
  [200_000, 14.7],
];

function estimateSeconds(maxNodes: number): number {
  const first = OBSERVED[0];
  const last = OBSERVED[OBSERVED.length - 1];
  if (maxNodes <= first[0]) return (maxNodes / first[0]) * first[1];
  for (let i = 1; i < OBSERVED.length; i++) {
    const [n0, t0] = OBSERVED[i - 1];
    const [n1, t1] = OBSERVED[i];
    if (maxNodes <= n1) {
      return t0 + ((maxNodes - n0) / (n1 - n0)) * (t1 - t0);
    }
  }
  // Past the last measurement, carry on at its local rate.
  return (maxNodes / last[0]) * last[1];
}

function describeWait(bot: BotOption): string {
  if (bot.maxNodes == null) return "";
  const seconds = estimateSeconds(bot.maxNodes);
  if (seconds < 1) return "Answers in about a second.";
  if (seconds < 3) return "Thinks for a couple of seconds a move.";
  if (seconds < 8) return "Thinks for several seconds a move.";
  if (seconds < 20) return "Thinks for around fifteen seconds a move.";
  return "Thinks for the best part of a minute a move.";
}

/** One labelled dial in the pair above. */
function Dial({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="botdial">
      <span className="botdial-label">{label}</span>
      <strong className="botdial-value">{value}</strong>
      <span className="botdial-detail">{detail}</span>
    </div>
  );
}

/** How hard it looks, in words. The number is shown alongside. */
function describeThinking(maxNodes: number | null): string {
  if (maxNodes == null) return "—";
  if (maxNodes <= 15_000) return "Glance";
  if (maxNodes <= 30_000) return "Quick";
  if (maxNodes <= 70_000) return "Steady";
  if (maxNodes <= 120_000) return "Deep";
  return "Exhaustive";
}

/**
 * What the accuracy dial means, in play.
 *
 * Worth spelling out rather than showing the percentage alone, because the
 * number on its own does not say how bad the other turns are — and whether a
 * bot can hang a game outright matters far more to a player than whether it
 * errs 20% of the time or 50%.
 */
function describeAccuracy(bot: BotOption): string {
  if (bot.accuracy == null || bot.accuracy >= 100) return "always its best move";
  const from = bot.poolFrom ?? 0;
  const otherwise =
    from >= 50
      ? "otherwise one of its worst"
      : from >= 20
        ? "otherwise a middling one"
        : "otherwise one of the next few";
  return bot.allowLosing
    ? `best move ${bot.accuracy}% of turns, ${otherwise} — losing moves included`
    : `best move ${bot.accuracy}% of turns, ${otherwise}, but never a losing one`;
}
