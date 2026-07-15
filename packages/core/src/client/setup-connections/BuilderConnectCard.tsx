import { IconCheck, IconLoader2, IconPlugConnected } from "@tabler/icons-react";

import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";

export interface BuilderConnectCardProps {
  title?: string;
  description?: string;
  trackingSource?: string;
  className?: string;
  onConnected?: (orgName: string | null) => void;
}

export function BuilderConnectCard({
  title = "Builder connect",
  description = "Connect Builder for managed model access, browser automation, and workspace identity.",
  trackingSource = "setup_connections_page",
  className,
  onConnected,
}: BuilderConnectCardProps) {
  const flow = useBuilderConnectFlow({
    trackingSource,
    onConnected: ({ orgName }) => onConnected?.(orgName),
  });

  const connectedLabel = flow.orgName
    ? `Connected to ${flow.orgName}`
    : "Connected";
  const statusLabel = !flow.hasFetchedStatus
    ? "Checking"
    : flow.configured
      ? connectedLabel
      : "Ready to connect";

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-background p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
            flow.configured
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {flow.configured ? (
            <IconCheck className="size-4" />
          ) : (
            <IconPlugConnected className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
          {flow.error ? (
            <p className="mt-2 text-xs text-destructive">{flow.error}</p>
          ) : null}
          {!flow.configured ? (
            <button
              type="button"
              onClick={() => flow.start()}
              disabled={flow.connecting}
              className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-border bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {flow.connecting ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconPlugConnected className="size-3.5" />
              )}
              Connect Builder
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
