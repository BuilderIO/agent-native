import {
  IconAlertCircle,
  IconCheck,
  IconClock,
  IconKey,
} from "@tabler/icons-react";

import type { WorkspaceConnectionProviderReadinessStatus } from "../../workspace-connections/index.js";
import { cn } from "../utils.js";

const STATUS_LABELS: Record<
  WorkspaceConnectionProviderReadinessStatus,
  string
> = {
  ready: "Ready",
  checking: "Checking",
  needs_credentials: "Needs credentials",
  needs_attention: "Needs attention",
  disabled: "Disabled",
  not_configured: "Not configured",
};

const STATUS_STYLES: Record<
  WorkspaceConnectionProviderReadinessStatus,
  string
> = {
  ready:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  checking:
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  needs_credentials:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  needs_attention:
    "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  disabled: "border-border bg-muted text-muted-foreground",
  not_configured: "border-border bg-muted text-muted-foreground",
};

function StatusIcon({
  status,
}: {
  status: WorkspaceConnectionProviderReadinessStatus;
}) {
  if (status === "ready") return <IconCheck className="size-3.5" />;
  if (status === "checking") return <IconClock className="size-3.5" />;
  if (status === "needs_credentials") return <IconKey className="size-3.5" />;
  return <IconAlertCircle className="size-3.5" />;
}

export interface ProviderReadinessBadgeProps {
  status: WorkspaceConnectionProviderReadinessStatus;
  label?: string;
  className?: string;
}

export function ProviderReadinessBadge({
  status,
  label,
  className,
}: ProviderReadinessBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      <StatusIcon status={status} />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}
