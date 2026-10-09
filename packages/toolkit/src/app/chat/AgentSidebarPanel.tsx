import { useEffect } from "react";

import { AgentPanel, type AgentPanelProps } from "./AgentPanel.js";
import { RealtimeVoiceModeProvider } from "./composer/index.js";
import { ExternalAgentNudge } from "./external-agent-host.js";

export function AgentSidebarPanel({
  onReadyChange,
  ...props
}: AgentPanelProps & { onReadyChange?: (ready: boolean) => void }) {
  useEffect(() => {
    onReadyChange?.(true);
    return () => onReadyChange?.(false);
  }, [onReadyChange]);

  return (
    <RealtimeVoiceModeProvider browserTabId={props.browserTabId}>
      <AgentPanel {...props} />
      <ExternalAgentNudge variant="sidebar" />
    </RealtimeVoiceModeProvider>
  );
}
