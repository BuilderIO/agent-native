/**
 * The agent's work as a strip of icon chips.
 *
 * One chip per step, typed by what kind of work it was — read, think, write,
 * call, wait — with the current one lit and the trail behind it dimmed. A run
 * reads as a short sequence of shapes rather than a stack of sentences: the
 * tool names are the agent's vocabulary, not the user's. The body underneath
 * shows only the step in flight, and the whole list is one chevron away.
 */

import {
  IconAlertTriangle,
  IconBrain,
  IconChevronDown,
  IconChevronUp,
  IconHourglass,
  IconPencil,
  IconPlug,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { AgentStep, AgentStepKind } from "../lib/agent-steps";

const KIND_ICON: Record<AgentStepKind, typeof IconBrain> = {
  think: IconBrain,
  read: IconSearch,
  write: IconPencil,
  call: IconPlug,
  wait: IconHourglass,
};

/** What to call the bucket, in flight and once it is over. */
const KIND_LABEL: Record<AgentStepKind, { running: string; done: string }> = {
  think: { running: "Thinking", done: "Thought" },
  read: { running: "Looking", done: "Looked" },
  write: { running: "Working", done: "Done" },
  call: { running: "Calling", done: "Called" },
  wait: { running: "Waiting", done: "Waited" },
};

export function AskSteps({
  steps,
  streaming,
}: {
  steps: AgentStep[] | undefined;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const count = steps?.length ?? 0;

  // Keep the newest chip in view as the strip grows past the pill's width.
  useEffect(() => {
    const strip = stripRef.current;
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [count]);

  if (!steps?.length) return null;

  const activeIndex = lastRunningIndex(steps);
  const active = steps[activeIndex] ?? steps[steps.length - 1];
  const failed = steps.some((s) => s.status === "error");
  const label = failed
    ? "Hit an error"
    : streaming || active.status === "running"
      ? KIND_LABEL[active.kind].running
      : KIND_LABEL[active.kind].done;

  return (
    <div className="pill-ask-work">
      <div className="pill-ask-work-head">
        <div className="pill-ask-chips" ref={stripRef}>
          {steps.map((step, i) => (
            <span
              key={step.key}
              className="pill-ask-chip-icon"
              data-status={step.status}
              data-active={i === activeIndex ? "true" : undefined}
              title={
                step.detail ? `${step.label} — ${step.detail}` : step.label
              }
            >
              <StepIcon step={step} />
            </span>
          ))}
        </div>
        <span className="pill-ask-work-label">{label}</span>
        <button
          type="button"
          data-no-drag
          className="pill-ask-work-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Hide the steps" : "Show every step"}
        >
          {expanded ? (
            <IconChevronUp size={13} stroke={2} aria-hidden />
          ) : (
            <IconChevronDown size={13} stroke={2} aria-hidden />
          )}
        </button>
      </div>

      {expanded ? (
        <ol className="pill-ask-work-list">
          {steps.map((step) => (
            <li key={step.key} data-status={step.status}>
              <span className="pill-ask-work-item-label">{step.label}</span>
              {step.detail ? (
                <span className="pill-ask-work-item-detail">{step.detail}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : streaming ? (
        <p className="pill-ask-work-now">{active.detail ?? active.label}</p>
      ) : null}
    </div>
  );
}

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "error") {
    return <IconAlertTriangle size={12} stroke={2} aria-hidden />;
  }
  const Icon = KIND_ICON[step.kind];
  return <Icon size={12} stroke={2} aria-hidden />;
}

/** The step in flight, or the last one when the run is over. */
function lastRunningIndex(steps: AgentStep[]): number {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].status === "running" || steps[i].status === "blocked")
      return i;
  }
  return steps.length - 1;
}
