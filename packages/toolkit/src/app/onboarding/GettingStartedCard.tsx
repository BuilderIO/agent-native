import { useOnboardingChecklist } from "@agent-native/core/client/onboarding/use-onboarding-checklist";
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";

import { Button } from "../../ui/button.js";
import { Progress } from "../../ui/progress.js";
import { Skeleton } from "../../ui/skeleton.js";
import { cn } from "../../utils.js";

export interface GettingStartedLabels {
  title: string;
  progress: (completeCount: number, totalCount: number) => string;
  /** Read by screen readers on a finished row; the check mark is decorative. */
  completed: string;
  collapse: string;
  expand: string;
  loadError: string;
  retry: string;
}

export interface GettingStartedLinkProps {
  to: string;
  className?: string;
  children: ReactNode;
}

function NativeLink({ to, className, children }: GettingStartedLinkProps) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}

export interface GettingStartedCardProps {
  /** Name the steps were registered under with `registerOnboardingStep({ checklist })`. */
  checklist: string;
  labels: GettingStartedLabels;
  /** Localized row titles by step id; a step without one shows its registered title. */
  stepTitles?: Record<string, string>;
  /** Router link for in-app rows so a click keeps the SPA and Cmd/Ctrl-click opens a tab. */
  LinkComponent?: ComponentType<GettingStartedLinkProps>;
  /** Number of rows to reserve while the first answer loads. */
  expectedSteps?: number;
  className?: string;
}

/**
 * Progress checklist pinned to the app sidebar. Each app registers its own
 * steps on the onboarding registry; the card only renders what the server
 * derived. It renders nothing once every step is done.
 */
export function GettingStartedCard({
  checklist,
  labels,
  stepTitles,
  LinkComponent = NativeLink,
  expectedSteps = 6,
  className,
}: GettingStartedCardProps) {
  const {
    steps,
    completeCount,
    totalCount,
    dismissed,
    collapsed,
    status,
    refresh,
    setCollapsed,
  } = useOnboardingChecklist(checklist);

  const frame = cn(
    "overflow-hidden rounded-[14px] border border-border bg-card text-card-foreground shadow-sm",
    className,
  );

  if (status === "loading") {
    return (
      <div className={frame} aria-hidden>
        <div className="space-y-3 px-4 py-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <div className="border-t border-border">
          {Array.from({ length: expectedSteps }, (_, index) => (
            <div key={index} className="flex min-h-12 items-center gap-3 px-4">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className={cn(
          frame,
          "flex items-center justify-between gap-2 px-4 py-3",
        )}
      >
        <span className="text-[13px] text-muted-foreground">
          {labels.loadError}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => void refresh()}
        >
          {labels.retry}
        </Button>
      </div>
    );
  }

  if (dismissed || totalCount === 0 || completeCount === totalCount) {
    return null;
  }

  const progressText = labels.progress(completeCount, totalCount);
  const ToggleIcon = collapsed ? IconChevronUp : IconChevronDown;

  return (
    <section className={frame} aria-label={labels.title}>
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold leading-5">{labels.title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={collapsed ? labels.expand : labels.collapse}
            aria-expanded={!collapsed}
            onClick={() => void setCollapsed(!collapsed)}
          >
            <ToggleIcon className="size-4" />
          </Button>
        </div>
        <Progress
          value={(completeCount / totalCount) * 100}
          className="h-1.5 bg-muted"
          aria-label={progressText}
        />
      </div>
      {collapsed ? null : (
        <ul className="border-t border-border">
          {steps.map((step) => {
            const rowClass =
              "flex min-h-12 items-center gap-3 px-4 text-[13px]";
            const content = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                    step.complete
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/60",
                  )}
                >
                  {step.complete ? <IconCheck className="size-3" /> : null}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    step.complete && "text-muted-foreground",
                  )}
                >
                  {stepTitles?.[step.id] ?? step.title}
                </span>
                {step.complete ? (
                  <span className="sr-only">{labels.completed}</span>
                ) : null}
              </>
            );
            return (
              <li key={step.id}>
                {step.href ? (
                  <LinkComponent
                    to={step.href}
                    className={cn(
                      rowClass,
                      "hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
                    )}
                  >
                    {content}
                  </LinkComponent>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
