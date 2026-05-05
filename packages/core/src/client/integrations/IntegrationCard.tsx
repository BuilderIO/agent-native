import React, { useState, useCallback } from "react";
import {
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconMessageCircle,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";
import type { IntegrationStatus } from "./useIntegrationStatus.js";
import { agentNativePath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const platformIcons: Record<string, React.ComponentType<any>> = {
  slack: IconBrandSlack as React.ComponentType<any>,
  telegram: IconBrandTelegram as React.ComponentType<any>,
  whatsapp: IconBrandWhatsapp as React.ComponentType<any>,
};

function StatusDot({
  enabled,
  configured,
}: {
  enabled: boolean;
  configured: boolean;
}) {
  const color =
    enabled && configured
      ? "bg-green-500"
      : configured
        ? "bg-yellow-500"
        : "bg-gray-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function IntegrationCard({
  status,
  onRefresh,
}: {
  status: IntegrationStatus;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const Icon = platformIcons[status.platform] || IconMessageCircle;

  const handleToggle = useCallback(async () => {
    setToggling(true);
    setToggleError(null);
    try {
      const action = status.enabled ? "disable" : "enable";
      const res = await fetch(
        agentNativePath(
          `/_agent-native/integrations/${status.platform}/${action}`,
        ),
        { method: "POST" },
      );
      if (res.ok) {
        onRefresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setToggleError(
        data?.error ||
          res.statusText ||
          `Couldn't ${action} ${status.label} (HTTP ${res.status})`,
      );
    } catch (err) {
      setToggleError(
        err instanceof Error
          ? err.message
          : "Network error reaching the server",
      );
    } finally {
      setToggling(false);
    }
  }, [status.platform, status.enabled, status.label, onRefresh]);

  const handleCopy = useCallback(async () => {
    if (!status.webhookUrl) return;
    await navigator.clipboard.writeText(status.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [status.webhookUrl]);

  return (
    <div className="rounded-md border border-border bg-background">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/50"
      >
        {expanded ? (
          <IconChevronDown
            size={12}
            className="text-muted-foreground shrink-0"
          />
        ) : (
          <IconChevronRight
            size={12}
            className="text-muted-foreground shrink-0"
          />
        )}
        <Icon size={16} className="text-muted-foreground shrink-0" />
        <span className="flex-1 text-xs font-medium text-foreground">
          {status.label}
        </span>
        <StatusDot enabled={status.enabled} configured={status.configured} />
      </button>

      {expanded && (
        <div className="border-t border-border px-2.5 py-2 space-y-2">
          {status.webhookUrl && (
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-1">
                Webhook URL
              </div>
              <div className="flex items-center gap-1">
                <code className="flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  {status.webhookUrl}
                </code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCopy}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    >
                      {copied ? (
                        <IconCheck size={12} />
                      ) : (
                        <IconCopy size={12} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy webhook URL</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {status.error && (
            <p className="text-[10px] text-destructive">{status.error}</p>
          )}

          {toggleError && (
            <p className="text-[10px] text-destructive">{toggleError}</p>
          )}

          {!status.configured && !status.error && (
            <p className="text-[10px] text-muted-foreground">
              Not configured. Set the required secrets to enable this
              integration.
            </p>
          )}

          {status.configured && (
            <button
              onClick={handleToggle}
              disabled={toggling}
              className="w-full rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent/50 disabled:opacity-50"
            >
              {toggling ? "..." : status.enabled ? "Disable" : "Enable"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
