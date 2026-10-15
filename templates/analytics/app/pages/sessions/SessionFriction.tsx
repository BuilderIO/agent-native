import { useT } from "@agent-native/core/client/i18n";
import { IconBug, IconRefresh } from "@tabler/icons-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  type AgentTroubleCause,
  REPLAY_FRICTION_SIGNALS,
  type ReplayFrictionSignal,
  type ScoredFrictionInput,
  SESSION_FRICTION_SIGNALS,
  SESSION_FRICTION_TOP_SIGNAL_LIMIT,
  type SessionFriction,
  type SessionFrictionSignal,
  type SessionFrictionSignalCount,
  type SessionTroubleGroup,
} from "../../../shared/session-friction";
import { issueDetailPath } from "./SessionDevToolsPanel";

type T = ReturnType<typeof useT>;

function isReplayFrictionSignal(
  signal: SessionFrictionSignal,
): signal is ReplayFrictionSignal {
  return (REPLAY_FRICTION_SIGNALS as readonly string[]).includes(signal);
}

export function frictionSignalLabel(signal: ScoredFrictionInput, t: T): string {
  switch (signal) {
    case "error_then_leave":
      return t("sessions.signalErrorThenLeave");
    case "http_5xx":
      return t("sessions.signalHttp5xx");
    case "retry_loops":
      return t("sessions.signalRetryLoops");
    case "error_toasts":
      return t("sessions.signalErrorToasts");
    case "dead_clicks":
      return t("sessions.signalDeadClicks");
    case "stalled_requests":
      return t("sessions.signalStalledRequests");
    case "http_4xx":
      return t("sessions.signalHttp4xx");
    case "agent_failures":
      return t("sessions.signalAgentFailures");
    case "stuck_chats":
      return t("sessions.signalStuckChats");
    case "thumbs_down":
      return t("sessions.signalThumbsDown");
    case "failed_actions":
      return t("sessions.signalFailedActions");
    case "quick_backs":
      return t("sessions.signalQuickBacks");
    case "cancelled_runs":
      return t("sessions.signalCancelledRuns");
    case "errors":
      return t("sessions.errors");
    case "rage_clicks":
      return t("sessions.rageClicksFilter");
  }
}

export function troubleCauseLabel(cause: AgentTroubleCause, t: T): string {
  switch (cause) {
    case "no_model_connected":
      return t("sessions.causeNoModelConnected");
    case "rate_limit":
      return t("sessions.causeRateLimit");
    case "context_overflow":
      return t("sessions.causeContextOverflow");
    case "provider_error":
      return t("sessions.causeProviderError");
  }
}

function troubleLabel(group: SessionTroubleGroup, t: T): string {
  if (group.cause) return troubleCauseLabel(group.cause, t);
  if (group.kind === "action" && group.status) {
    return t("sessions.troubleWithStatus", {
      label: group.label,
      status: group.status,
    });
  }
  return group.label;
}

export function SessionFrictionFilter({
  signals,
  onChange,
}: {
  signals: SessionFrictionSignal[];
  onChange: (signals: SessionFrictionSignal[]) => void;
}) {
  const t = useT();
  const active = signals.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          size="sm"
          className={cn(
            "h-8 border border-input font-normal",
            !active && "bg-transparent hover:bg-accent",
          )}
        >
          {active
            ? t("sessions.frictionFiltersActive", {
                count: String(signals.length),
              })
            : t("sessions.friction")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60">
        <div className="space-y-3">
          {SESSION_FRICTION_SIGNALS.map((signal) => {
            const label = frictionSignalLabel(signal, t);
            return (
              <label
                key={signal}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  aria-label={label}
                  checked={signals.includes(signal)}
                  onCheckedChange={(value) =>
                    onChange(
                      value === true
                        ? [...signals, signal]
                        : signals.filter((current) => current !== signal),
                    )
                  }
                />
                {label}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A signal's count, or null when the session never measured it. */
function signalCount(
  friction: SessionFriction,
  signal: SessionFrictionSignal,
): number | null {
  if (isReplayFrictionSignal(signal)) {
    return friction.replay ? friction.replay[signal] : null;
  }
  return friction.events ? friction.events[signal] : null;
}

/**
 * The row's heaviest signals, led by the ones the list is filtered or sorted
 * by: a row that matched on a light signal would otherwise hide why it is
 * there.
 */
function shownSignals(
  friction: SessionFriction,
  pinned: readonly SessionFrictionSignal[],
): SessionFrictionSignalCount[] {
  const pinnedCounts = [...new Set(pinned)].flatMap((signal) => {
    const count = signalCount(friction, signal);
    return count ? [{ signal, count }] : [];
  });
  const rest = friction.topSignals.filter(
    ({ signal }) => !pinnedCounts.some((entry) => entry.signal === signal),
  );
  return [...pinnedCounts, ...rest].slice(
    0,
    Math.max(SESSION_FRICTION_TOP_SIGNAL_LIMIT, pinnedCounts.length),
  );
}

function ErrorIssueLinks({
  issues,
}: {
  issues: SessionFriction["errorIssues"];
}) {
  const t = useT();
  if (issues === null) {
    return (
      <span className="text-muted-foreground">
        {t("sessions.issueLinksUnavailable")}
      </span>
    );
  }
  return (
    <>
      {issues.map((issue) => (
        <Link
          key={issue.id}
          to={issueDetailPath(issue.id)}
          className="inline-flex max-w-64 items-center gap-1 text-destructive hover:underline"
          aria-label={t("sessions.openErrorIssue", { title: issue.title })}
        >
          <IconBug className="size-3.5 shrink-0" />
          <span className="truncate">{issue.title}</span>
        </Link>
      ))}
    </>
  );
}

/**
 * A row's top friction signals, its trouble groups, and its error issues.
 * When the list is sorted by one signal, a row that never measured it says
 * so rather than passing for zero.
 */
export function SessionFrictionStrip({
  friction,
  sortSignal,
  filterSignals = [],
}: {
  friction: SessionFriction | undefined;
  sortSignal?: SessionFrictionSignal;
  filterSignals?: readonly SessionFrictionSignal[];
}) {
  const t = useT();
  if (!friction) return null;
  const issues = friction.errorIssues;
  const measured = friction.replay !== null || friction.events !== null;
  const unmeasuredSortSignal =
    measured && sortSignal && signalCount(friction, sortSignal) === null
      ? sortSignal
      : null;
  const signals = shownSignals(friction, [
    ...filterSignals,
    ...(sortSignal ? [sortSignal] : []),
  ]);
  if (
    measured &&
    !signals.length &&
    issues?.length === 0 &&
    !unmeasuredSortSignal
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 text-xs">
      {measured ? (
        <>
          {signals.map(({ signal, count }) => (
            <Badge key={signal} variant="secondary" className="font-normal">
              {signal === "error_then_leave"
                ? frictionSignalLabel(signal, t)
                : t("sessions.frictionSignalCount", {
                    label: frictionSignalLabel(signal, t),
                    count: count.toLocaleString(),
                  })}
            </Badge>
          ))}
          {friction.troubles.slice(0, 2).map((group) => (
            <Badge
              key={`${group.kind}:${group.label}:${group.status ?? ""}`}
              variant="outline"
              className="max-w-64 truncate font-normal"
              title={troubleLabel(group, t)}
            >
              {troubleLabel(group, t)}
            </Badge>
          ))}
          {unmeasuredSortSignal ? (
            <span className="text-muted-foreground">
              {t("sessions.signalNotMeasured", {
                label: frictionSignalLabel(unmeasuredSortSignal, t),
              })}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">
          {t("sessions.frictionNotMeasured")}
        </span>
      )}
      <ErrorIssueLinks issues={issues} />
    </div>
  );
}

/**
 * One session's count for every friction signal, its trouble groups, and its
 * error issues. A signal the session never measured says so, never zero.
 */
export function SessionFrictionBreakdown({
  friction,
}: {
  friction: SessionFriction;
}) {
  const t = useT();
  const measured = friction.replay !== null || friction.events !== null;
  return (
    <div className="flex flex-col gap-3 px-3 py-2 text-xs">
      {measured ? (
        <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {SESSION_FRICTION_SIGNALS.map((signal) => {
            const label = frictionSignalLabel(signal, t);
            const count = signalCount(friction, signal);
            return (
              <li
                key={signal}
                className={cn(!count && "text-muted-foreground")}
              >
                {count === null
                  ? t("sessions.signalNotMeasured", { label })
                  : t("sessions.frictionSignalCount", {
                      label,
                      count: count.toLocaleString(),
                    })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {t("sessions.frictionNotMeasured")}
        </p>
      )}
      {friction.troubles.length ? (
        <ul className="grid gap-1.5">
          {friction.troubles.map((group) => (
            <li
              key={`${group.kind}:${group.label}:${group.status ?? ""}`}
              className="truncate"
              title={troubleLabel(group, t)}
            >
              {t("sessions.frictionSignalCount", {
                label: troubleLabel(group, t),
                count: group.count.toLocaleString(),
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {friction.errorIssues?.length !== 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ErrorIssueLinks issues={friction.errorIssues} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The replay's friction tab: the breakdown once loaded, or a failed read
 * with a retry, never an empty breakdown in its place.
 */
export function SessionFrictionPanel({
  friction,
  failed,
  fetching,
  onRetry,
}: {
  friction: SessionFriction | undefined;
  failed: boolean;
  fetching: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (friction) return <SessionFrictionBreakdown friction={friction} />;
  if (failed) {
    return (
      <p
        className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        {t("sessions.frictionUnavailable")}
        <Button variant="ghost" size="xs" onClick={onRetry} disabled={fetching}>
          <IconRefresh className={cn(fetching && "animate-spin")} />
          {t("sidebar.retry")}
        </Button>
      </p>
    );
  }
  return (
    <div className="grid gap-x-4 gap-y-1.5 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-4 w-32" />
      ))}
    </div>
  );
}
