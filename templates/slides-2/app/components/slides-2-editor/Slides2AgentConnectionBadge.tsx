import { useT } from "@agent-native/core/client/i18n";
import { useAgentEngineConfigured } from "@agent-native/core/client/use-agent-engine-configured";
import { Status } from "@agent-native/toolkit/design-system";

export function Slides2AgentConnectionBadge() {
  const { state } = useAgentEngineConfigured();
  const t = useT();
  const label = t("slides2Editor.agentConnected");
  const status = (
    <Status
      className="h-6 gap-1.5 rounded-md border-border/70 bg-muted/20 px-2 py-0 text-xs font-medium text-foreground"
      size="compact"
      tone="success"
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full slides2-agent-connected-dot"
      />
      {label}
    </Status>
  );

  if (state !== "configured") {
    return (
      <div
        aria-hidden="true"
        className="invisible inline-flex shrink-0"
        data-agent-connection-placeholder
      >
        {status}
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className="inline-flex shrink-0"
      data-agent-connection-status={state}
      role="status"
    >
      {status}
    </div>
  );
}
