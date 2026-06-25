import {
  IconAlertTriangle,
  IconBrowser,
  IconCheck,
  IconDeviceDesktop,
  IconLoader2,
  IconPlugConnected,
} from "@tabler/icons-react";
import React from "react";

import { cn } from "../utils.js";
import {
  useToggleBuiltinCapability,
  type BuiltinCapability,
  type BuiltinCapabilityStatus,
} from "./use-builtin-capabilities.js";
import type { McpServerScope } from "./use-mcp-servers.js";

interface BuiltinCapabilityDetailProps {
  capability: BuiltinCapability;
  scope: McpServerScope;
  canEditOrg: boolean;
}

export function BuiltinCapabilityDetail({
  capability,
  scope,
  canEditOrg,
}: BuiltinCapabilityDetailProps) {
  const toggle = useToggleBuiltinCapability();
  const enabled = capability.enabled[scope];
  const status = capability.status[scope];
  const canToggle =
    capability.available &&
    (scope === "user" || canEditOrg) &&
    !toggle.isPending;
  const isBrowser = capability.exclusiveGroup === "browser";

  const onToggle = () => {
    if (!canToggle) return;
    toggle.mutate({ id: capability.id, scope, enabled: !enabled });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          {isBrowser ? (
            <IconBrowser className="h-4 w-4 text-muted-foreground" />
          ) : (
            <IconDeviceDesktop className="h-4 w-4 text-muted-foreground" />
          )}
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
            {capability.name}
          </h2>
          <StatusBadge enabled={enabled} status={status} />
        </div>

        <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
          {capability.description}
        </p>

        <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-foreground">
                {scope === "user" ? "Personal" : "Organization"} access
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {scope === "user"
                  ? "Available only to your agent sessions."
                  : "Available to agents in the active organization."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={!canToggle}
              onClick={onToggle}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
                enabled ? "bg-primary" : "bg-muted-foreground/25",
                !canToggle && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                  enabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {toggle.isPending && (
            <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <IconLoader2 className="h-3 w-3 animate-spin" />
              Updating tools…
            </div>
          )}
          {toggle.error && (
            <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">
              {toggle.error instanceof Error
                ? toggle.error.message
                : "Could not update this capability."}
            </div>
          )}
        </div>

        <dl className="space-y-3">
          <Field label="Command">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground break-all">
              {capability.command} {capability.args.join(" ")}
            </code>
          </Field>

          {capability.notes && (
            <Field label="Requirements">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {capability.notes}
              </p>
            </Field>
          )}

          {!capability.available && (
            <Field label="Availability">
              <p className="text-[12px] leading-relaxed text-red-600 dark:text-red-400">
                {capability.unavailableReason ?? "Not available on this host."}
              </p>
            </Field>
          )}

          <Field label="Tools">
            <ToolsSummary enabled={enabled} status={status} />
          </Field>
        </dl>

        {capability.id === "computer-use" && (
          <p className="mt-6 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            macOS may ask for Screen Recording and Accessibility permission
            before the tools can control local apps. The agent should still ask
            before taking sensitive desktop actions.
          </p>
        )}

        {capability.id === "browser-chrome-devtools" && (
          <p className="mt-6 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Chrome DevTools attaches to your live Chrome profile when remote
            debugging is available, so it can verify pages that rely on your
            existing login.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function StatusBadge({
  enabled,
  status,
}: {
  enabled: boolean;
  status?: BuiltinCapabilityStatus;
}) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Off
      </span>
    );
  }
  if (status?.state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
        <IconCheck className="h-2.5 w-2.5" />
        Connected
      </span>
    );
  }
  if (status?.state === "error") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
        title={status.error}
      >
        <IconAlertTriangle className="h-2.5 w-2.5" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <IconPlugConnected className="h-2.5 w-2.5" />
      Ready
    </span>
  );
}

function ToolsSummary({
  enabled,
  status,
}: {
  enabled: boolean;
  status?: BuiltinCapabilityStatus;
}) {
  if (!enabled) {
    return (
      <span className="text-[12px] text-muted-foreground">
        Disabled. Toggle it on to expose MCP tools to the agent.
      </span>
    );
  }
  if (status?.state === "connected") {
    return (
      <span className="text-[12px] text-foreground">
        {status.toolCount} tool{status.toolCount === 1 ? "" : "s"} exposed
      </span>
    );
  }
  if (status?.state === "error") {
    return (
      <span className="text-[12px] text-red-600 dark:text-red-400">
        {status.error}
      </span>
    );
  }
  return (
    <span className="text-[12px] text-muted-foreground">
      Enabled. Tools will appear after the MCP manager connects.
    </span>
  );
}
