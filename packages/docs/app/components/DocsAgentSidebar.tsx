import { useT } from "@agent-native/core/client/i18n";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { useEffect } from "react";

export default function DocsAgentSidebar({ onReady }: { onReady: () => void }) {
  const t = useT();
  // Child effects install the sidebar's listeners before queued events replay.
  useEffect(onReady, [onReady]);

  return (
    <AgentSidebar
      screenRefreshEnabled={false}
      storageKey="docs"
      position="right"
      defaultOpen={false}
      defaultSidebarWidth={400}
      emptyStateText={t("agent.emptyState")}
      suggestions={[
        t("agent.suggestionGettingStarted"),
        t("agent.suggestionActions"),
        t("agent.suggestionPolling"),
        t("agent.suggestionDeploy"),
      ]}
    >
      {null}
    </AgentSidebar>
  );
}
