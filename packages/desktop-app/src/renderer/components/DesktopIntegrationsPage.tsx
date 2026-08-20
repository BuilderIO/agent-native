import { ConnectionsTab } from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import {
  McpServersApiProvider,
  type McpServersApi,
} from "@agent-native/core/client/resources";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

export default function DesktopIntegrationsPage({
  targetWebContentsId,
}: {
  targetWebContentsId?: number;
}) {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const startOAuth = useCallback(
    async (url: string) => {
      const handler = window.electronAPI?.mcpServers?.startOAuth;
      if (!handler) {
        throw new Error("Desktop OAuth is unavailable in this session.");
      }
      if (targetWebContentsId === undefined) {
        throw new Error(
          "The signed-in Dispatch integrations tab is not ready for OAuth.",
        );
      }
      await handler(url, targetWebContentsId);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    [queryClient, targetWebContentsId],
  );
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
          <QueryClientProvider client={queryClient}>
            <McpServersApiProvider api={desktopMcpApi}>
              <ConnectionsTab
                onOAuthStart={startOAuth}
                oauthReturnPath="/integrations"
              />
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
