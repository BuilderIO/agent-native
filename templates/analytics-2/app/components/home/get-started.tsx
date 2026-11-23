import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconCircle,
  IconDatabase,
  IconFileImport,
  IconMessagePlus,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export type HomeGetStartedStep = "connect" | "project" | "ask";

const STEP_ORDER: readonly HomeGetStartedStep[] = ["connect", "project", "ask"];

const STEP_LABELS: Record<HomeGetStartedStep, string> = {
  connect: "Add a data source",
  project: "Create your first project",
  ask: "Ask the agent a question",
};

export function HomeGetStartedGrid({
  canAddConnection,
  onCreateProject,
  onCreateThread,
  onImportProject,
  onAskAgent,
  completedSteps = [],
  onDismiss,
  checklistDismissed = false,
  onRestore,
  saving = false,
}: {
  canAddConnection: boolean;
  onCreateProject?: (() => void) | undefined;
  onCreateThread?: (() => void) | undefined;
  onImportProject?: (() => void) | undefined;
  onAskAgent?: (() => void) | undefined;
  completedSteps?: readonly HomeGetStartedStep[];
  onDismiss?: (() => void) | undefined;
  checklistDismissed?: boolean;
  onRestore?: (() => void) | undefined;
  saving?: boolean;
}) {
  const t = useT();
  const completed = new Set(completedSteps);
  const done = STEP_ORDER.filter((step) => completed.has(step)).length;
  const percent = Math.round((done / STEP_ORDER.length) * 100);
  const currentStep = STEP_ORDER.find((step) => !completed.has(step));
  return (
    <>
      {checklistDismissed ? (
        onRestore ? (
          <button
            type="button"
            className="ws-home-button"
            onClick={onRestore}
            disabled={saving}
          >
            Show setup checklist
          </button>
        ) : null
      ) : (
        <div className="ws-home-checklist">
          <div className="ws-home-checklist-header">
            <span className="ws-home-checklist-count">
              {`${done} of ${STEP_ORDER.length} complete`}
            </span>
            {onDismiss != null ? (
              <button
                type="button"
                className="ws-home-curate-dismiss"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={onDismiss}
                disabled={saving}
              >
                <IconX size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div
            className="ws-home-checklist-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Get started progress"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <ol className="ws-home-checklist-steps">
            {STEP_ORDER.map((step) => {
              const isComplete = completed.has(step);
              const icon = isComplete ? (
                <IconCheck size={14} aria-hidden="true" />
              ) : (
                <IconCircle size={14} aria-hidden="true" />
              );
              const label = (
                <>
                  {icon}
                  <span>{STEP_LABELS[step]}</span>
                </>
              );
              return (
                <li
                  key={step}
                  className={`ws-home-checklist-step${
                    isComplete ? " is-complete" : ""
                  }${step === currentStep ? " is-current" : ""}`}
                >
                  {step === "connect" && canAddConnection ? (
                    <Link
                      className="ws-home-checklist-link"
                      to="/home/data?connect=1"
                    >
                      {label}
                    </Link>
                  ) : step === "project" && onCreateProject ? (
                    <button
                      type="button"
                      className="ws-home-checklist-link"
                      onClick={onCreateProject}
                    >
                      {label}
                    </button>
                  ) : step === "ask" && onAskAgent ? (
                    <button
                      type="button"
                      className="ws-home-checklist-link"
                      onClick={onAskAgent}
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <div className="ws-home-card-grid">
        {canAddConnection && (
          <article className="ws-home-card">
            <Link className="ws-home-card-title" to="/home/data?connect=1">
              <IconDatabase aria-hidden="true" size={16} stroke={1.8} />
              {t("dataBrowser.firstRun.connectTitle")}
            </Link>
          </article>
        )}
        {onCreateThread && (
          <FirstStepCard
            icon={<IconMessagePlus aria-hidden="true" size={16} stroke={1.8} />}
            title={t("analytics.home.firstStep.thread")}
            description={t("analytics.home.firstStep.threadDescription")}
            onClick={onCreateThread}
          />
        )}
        {onCreateProject && (
          <FirstStepCard
            icon={<IconPlus aria-hidden="true" size={16} stroke={1.8} />}
            title={t("analytics.home.firstStep.project")}
            description={t("analytics.home.firstStep.projectDescription")}
            onClick={onCreateProject}
          />
        )}
        {onCreateProject && onImportProject && (
          <FirstStepCard
            icon={<IconFileImport aria-hidden="true" size={16} stroke={1.8} />}
            title={t("analytics.home.firstStep.import")}
            description={t("analytics.home.firstStep.importDescription")}
            onClick={onImportProject}
          />
        )}
      </div>
    </>
  );
}

function FirstStepCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <article className="ws-home-card is-interactive">
      <button className="ws-home-card-title" onClick={onClick} type="button">
        {icon}
        {title}
      </button>
      <p className="ws-home-card-description">{description}</p>
    </article>
  );
}
