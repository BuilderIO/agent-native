/**
 * The agent's work, above its answer.
 *
 * While a run streams, each tool call is a row that names what the agent is
 * doing and then reports how it went. Once the answer lands the rows collapse
 * to one line, because after the fact the work is context, not the point —
 * the same reason a finished build shows a summary and not its log.
 */

import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHourglass,
} from "@tabler/icons-react";
import { useState } from "react";

import type { AgentStep } from "../lib/agent-steps";

/** Rows visible while streaming. Older completed work scrolls off the top. */
const LIVE_WINDOW = 3;

export function AskSteps({
  steps,
  streaming,
}: {
  steps: AgentStep[] | undefined;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!steps?.length) return null;

  const failed = steps.filter((s) => s.status === "error").length;
  const blocked = steps.some((s) => s.status === "blocked");
  const collapsed = !streaming && !expanded && !blocked;

  if (collapsed) {
    return (
      <button
        type="button"
        data-no-drag
        className="pill-ask-steps-summary"
        onClick={() => setExpanded(true)}
        aria-label="Show what the agent did"
      >
        <IconChevronRight size={12} stroke={2} aria-hidden />
        {failed
          ? `${failed} of ${steps.length} ${stepWord(steps.length)} failed`
          : `${steps.length} ${stepWord(steps.length)}`}
      </button>
    );
  }

  // Streaming keeps the newest rows in view; expanding after the fact shows
  // everything, since that is the whole reason to expand.
  const visible = streaming ? steps.slice(-LIVE_WINDOW) : steps;

  return (
    <div className="pill-ask-steps">
      {visible.map((step) => (
        <div key={step.key} className="pill-ask-step" data-status={step.status}>
          <StepGlyph status={step.status} />
          <span className="pill-ask-step-label">{step.label}</span>
          {step.detail ? (
            <span className="pill-ask-step-detail">{step.detail}</span>
          ) : null}
        </div>
      ))}
      {expanded ? (
        <button
          type="button"
          data-no-drag
          className="pill-ask-steps-summary"
          onClick={() => setExpanded(false)}
          aria-label="Hide what the agent did"
        >
          <IconChevronDown size={12} stroke={2} aria-hidden />
          Hide steps
        </button>
      ) : null}
    </div>
  );
}

function StepGlyph({ status }: { status: AgentStep["status"] }) {
  if (status === "done") {
    return <IconCheck size={12} stroke={2.5} aria-hidden />;
  }
  if (status === "error") {
    return <IconAlertTriangle size={12} stroke={2} aria-hidden />;
  }
  if (status === "blocked") {
    return <IconHourglass size={12} stroke={2} aria-hidden />;
  }
  return <span className="pill-ask-step-dot" aria-hidden />;
}

function stepWord(count: number): string {
  return count === 1 ? "step" : "steps";
}
