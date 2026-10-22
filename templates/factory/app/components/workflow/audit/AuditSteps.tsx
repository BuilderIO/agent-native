import { useLocale } from "@agent-native/core/client/i18n";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconLoader2,
  type Icon,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useItemsStrings, type ItemsStrings } from "../items-strings";
import { formatDateTime, formatDuration } from "../items/format";
import type { NodeAuditStep, StepStatus } from "../items/read-types";

const STATUS_ICONS: Record<StepStatus, Icon> = {
  running: IconLoader2,
  succeeded: IconCheck,
  failed: IconAlertCircle,
  skipped: IconCircleDashed,
  needs_check: IconAlertTriangle,
};

function portsText(
  ports: Record<string, number>,
  portLabel: (port: string) => string,
  s: ItemsStrings,
): string {
  return Object.entries(ports)
    .map(([port, count]) => s.audit.portCount(portLabel(port), count))
    .join(" · ");
}

/** One row per recent run of the node: when, how it ended, what left, how long. */
export function AuditSteps({
  steps,
  portLabel,
}: {
  steps: readonly NodeAuditStep[];
  portLabel: (port: string) => string;
}) {
  const s = useItemsStrings();
  const { locale } = useLocale();

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {steps.map((step) => {
        const StepIcon = STATUS_ICONS[step.status];
        const bad = step.status === "failed" || step.status === "needs_check";
        const ports = portsText(step.ports, portLabel, s);
        return (
          <li key={step.runId} className="space-y-1 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <StepIcon
                className={cn(
                  "size-4 shrink-0",
                  bad ? "text-destructive" : "text-muted-foreground",
                  step.status === "running" && "motion-safe:animate-spin",
                )}
                aria-label={s.audit.stepStatus[step.status]}
                role="img"
              />
              <time
                dateTime={step.startedAt}
                className="min-w-0 flex-1 truncate tabular-nums"
              >
                {formatDateTime(step.startedAt, locale)}
              </time>
              {step.mode !== "live" ? (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[0.6875rem]"
                >
                  {s.mode[step.mode]}
                </Badge>
              ) : null}
              {step.durationMs !== null ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDuration(step.durationMs, s)}
                </span>
              ) : null}
            </div>
            {ports ? (
              <p className="ps-6 text-xs text-muted-foreground">{ports}</p>
            ) : null}
            {step.error ? (
              <p className="break-words ps-6 text-xs text-destructive">
                <span className="font-mono font-medium">{step.error.code}</span>
                {": "}
                {step.error.message}
              </p>
            ) : null}
            {step.inputTruncated ? (
              <p className="ps-6 text-xs text-muted-foreground">
                {s.audit.stepInput}
              </p>
            ) : null}
            {step.truncated ? (
              <p className="ps-6 text-xs text-muted-foreground">
                {s.audit.stepTruncated(step.truncated.totalAvailable)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
