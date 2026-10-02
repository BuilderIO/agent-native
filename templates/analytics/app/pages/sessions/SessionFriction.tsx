import { useT } from "@agent-native/core/client/i18n";
import { IconBug } from "@tabler/icons-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  type AgentTroubleCause,
  type ScoredFrictionInput,
  SESSION_FRICTION_SIGNALS,
  type SessionFriction,
  type SessionFrictionSignal,
  type SessionTroubleGroup,
} from "../../../shared/session-friction";
import { issueDetailPath } from "./SessionDevToolsPanel";

type T = ReturnType<typeof useT>;

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
    case "slow_requests":
      return t("sessions.signalSlowRequests");
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

/** A row's top friction signals, its trouble groups, and its error issues. */
export function SessionFrictionStrip({
  friction,
}: {
  friction: SessionFriction | undefined;
}) {
  const t = useT();
  if (!friction) return null;
  const issues = friction.errorIssues ?? [];
  const measured = friction.replay !== null || friction.events !== null;
  if (measured && !friction.topSignals.length && !issues.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 text-xs">
      {measured ? (
        <>
          {friction.topSignals.map(({ signal, count }) => (
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
        </>
      ) : (
        <span className="text-muted-foreground">
          {t("sessions.frictionNotMeasured")}
        </span>
      )}
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
    </div>
  );
}
