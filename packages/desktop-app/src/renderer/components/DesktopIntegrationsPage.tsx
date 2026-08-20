import { ConnectionsTab } from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import {
  McpServersApiProvider,
  type McpServersApi,
} from "@agent-native/core/client/resources";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";

const desktopIntegrationsQueryClient = createAgentNativeQueryClient();

export default function DesktopIntegrationsPage() {
  const desktopMcpApi = useMemo<McpServersApi | null>(() => {
    const api = window.electronAPI?.mcpServers;
    if (!api) return null;
    return {
      list: api.list,
      create: api.create,
      delete: api.delete,
      reconnect: api.reconnect,
      test: api.test,
      testExisting: api.testExisting,
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-4xl p-6 sm:p-8">
        {desktopMcpApi ? (
          <QueryClientProvider client={desktopIntegrationsQueryClient}>
            <McpServersApiProvider api={desktopMcpApi}>
              <ConnectionsTab />
            </McpServersApiProvider>
          </QueryClientProvider>
        ) : (
          <p
            className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
            role="status"
          >
            Connections are unavailable in this Desktop session.
          </p>
        )}
      </div>
    </div>
  );
}
