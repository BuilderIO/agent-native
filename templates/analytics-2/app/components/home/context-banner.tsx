import {
  IconArrowRight,
  IconBadge,
  IconBook,
  IconCheck,
  IconDatabase,
  IconGitBranch,
  IconPlug,
  IconSitemap,
  IconX,
} from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";

import type { HomeContextProgress, HomeStepKey } from "./types";

const STEP_ORDER: readonly HomeStepKey[] = [
  "connect",
  "endorse",
  "improve",
  "reference",
  "extend",
  "govern",
];

/** Source actionText: constants.tsx CONTEXT_SETUP_STEPPER_DETAILS. */
const STEP_LABELS: Record<HomeStepKey, string> = {
  connect: "Connect",
  endorse: "Endorse",
  improve: "Improve",
  reference: "Reference",
  extend: "Extend",
  govern: "Govern",
};

const STEP_ICONS: Record<HomeStepKey, ReactNode> = {
  connect: <IconDatabase size={14} aria-hidden="true" />,
  endorse: <IconBadge size={14} aria-hidden="true" />,
  improve: <IconBook size={14} aria-hidden="true" />,
  reference: <IconGitBranch size={14} aria-hidden="true" />,
  extend: <IconPlug size={14} aria-hidden="true" />,
  govern: <IconSitemap size={14} aria-hidden="true" />,
};

export function HomeContextBanner({
  progress,
  onSelectStep,
  onDismiss,
}: {
  progress: HomeContextProgress;
  onSelectStep?: (step: HomeStepKey) => void;
  onDismiss?: () => void;
}) {
  // Every step is a navigation and the dismiss writes state. Without a caller
  // for the steps the banner would be a row of dead buttons on Home, so it is
  // not rendered at all until the setup views behind it exist.
  if (onSelectStep == null) return null;

  const steps = (progress.steps ?? STEP_ORDER).filter(
    (step, index, all) =>
      STEP_ORDER.includes(step) && all.indexOf(step) === index,
  );
  const completed = new Set(progress.completedSteps);
  const currentStep = steps.find((step) => !completed.has(step));
  const dismissLabel = progress.canDismiss ? "Dismiss" : "Remind me later";
  const percentStyle = {
    "--ws-home-progress": `${Math.max(0, Math.min(100, progress.progressPercent))}%`,
  } as CSSProperties;

  return (
    <div className="ws-home-curate" role="status">
      <span
        className="ws-home-curate-progress"
        style={percentStyle}
        aria-hidden="true"
      >
        <span className="ws-home-curate-progress-center" />
      </span>
      <span className="ws-home-curate-copy">
        <span className="ws-home-curate-title">Curate your context</span>
        <span className="ws-home-curate-subtitle">
          For more accurate answers
        </span>
      </span>
      <span className="ws-home-curate-steps">
        {steps.map((step, index) => {
          const isComplete = completed.has(step);
          const isCurrent = step === currentStep;
          return (
            <span className="ws-home-curate-step-wrap" key={step}>
              <button
                type="button"
                className={`ws-home-curate-step${
                  isComplete ? " is-complete" : ""
                }${isCurrent ? " is-current" : ""}`}
                onClick={() => onSelectStep(step)}
                title={STEP_LABELS[step]}
              >
                {isComplete ? (
                  <IconCheck size={14} aria-hidden="true" />
                ) : (
                  STEP_ICONS[step]
                )}
                <span>{STEP_LABELS[step]}</span>
              </button>
              {index !== steps.length - 1 ? (
                <IconArrowRight
                  className="ws-home-curate-arrow"
                  size={14}
                  aria-hidden="true"
                />
              ) : null}
            </span>
          );
        })}
      </span>
      {onDismiss != null ? (
        <button
          type="button"
          className="ws-home-curate-dismiss"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
