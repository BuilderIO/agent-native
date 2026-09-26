
import {
  IconAlertTriangle,
  IconBrain,
  IconChevronDown,
  IconChevronUp,
  IconFileText,
  IconHourglass,
  IconPencil,
  IconPlug,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { AgentStep, AgentStepKind } from "../lib/agent-steps";

const KIND_ICON: Record<AgentStepKind, typeof IconBrain> = {
  think: IconBrain,
  read: IconFileText,
  search: IconSearch,
  write: IconPencil,
  call: IconPlug,
  wait: IconHourglass,
};

const KIND_LABEL: Record<AgentStepKind, { running: string; done: string }> = {
  think: { running: "Thinking", done: "Thought" },
  read: { running: "Reading", done: "Read" },
  search: { running: "Searching", done: "Searched" },
  write: { running: "Saving", done: "Saved" },
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
  const [scrolled, setScrolled] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const count = steps?.length ?? 0;

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = strip.scrollWidth;
    setScrolled(strip.scrollLeft > 2);
  }, [count]);

  if (!steps?.length) return null;

  const activeIndex = lastRunningIndex(steps);
  const active = steps[activeIndex] ?? steps[steps.length - 1];
  const failed = steps.some((s) => s.status === "error");
  const label = failed
    ? "Hit an error"
    : active.status === "running" || active.status === "blocked"
      ? KIND_LABEL[active.kind].running
      : streaming
        ? "Answering"
        : KIND_LABEL[active.kind].done;

  return (
    <div className="pill-ask-work">
      <div className="pill-ask-work-head">
        <div
          className="pill-ask-chips"
          ref={stripRef}
          data-scrolled={scrolled ? "true" : undefined}
          onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 2)}
        >
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
    return <IconAlertTriangle size={15} stroke={1.75} aria-hidden />;
  }
  const Icon = KIND_ICON[step.kind];
  return <Icon size={15} stroke={1.75} aria-hidden />;
}

function lastRunningIndex(steps: AgentStep[]): number {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].status === "running" || steps[i].status === "blocked")
      return i;
  }
  return steps.length - 1;
}
