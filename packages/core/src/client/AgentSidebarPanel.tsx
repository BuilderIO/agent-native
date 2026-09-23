import { RealtimeVoiceModeProvider } from "@agent-native/toolkit/composer/useRealtimeVoiceMode";

import { AgentPanel, type AgentPanelProps } from "./AgentPanel.js";
import { ExternalAgentNudge } from "./external-agent-host.js";

export function AgentSidebarPanel(props: AgentPanelProps) {
  return (
    <RealtimeVoiceModeProvider browserTabId={props.browserTabId}>
      <AgentPanel {...props} />
      <ExternalAgentNudge variant="sidebar" />
    </RealtimeVoiceModeProvider>
  );
}
