import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { McpIntegrationsLanding } from "@agent-native/core/client/integrations";
import {
  McpServersApiProvider,
  type McpServersApi,
} from "@agent-native/core/client/resources";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

export default function DesktopIntegrationsPage({
  targetWebContentsId,
  onOAuthActiveChange,
}: {
  targetWebContentsId?: number;
  onOAuthActiveChange?: (active: boolean) => void;
}) {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const startOAuth = useCallback(
    async (url: string) => {
      const handler = window.electronAPI?.mcpServers
        ? (oauthUrl: string, webContentsId: number) =>
            window.electronAPI!.mcpServers!.startOAuth(oauthUrl, webContentsId)
        : undefined;
      if (!handler) {
        throw new Error("Desktop OAuth is unavailable in this session.");
      }
      if (targetWebContentsId === undefined) {
        throw new Error(
          "The signed-in Dispatch integrations tab is not ready for OAuth.",
        );
      }
      onOAuthActiveChange?.(true);
      try {
        await handler(url, targetWebContentsId);
        await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      } finally {
        onOAuthActiveChange?.(false);
      }
    },
    [onOAuthActiveChange, queryClient, targetWebContentsId],
  );
  const desktopMcpApi = useMemo<McpServersApi | null>(() => {
    const api = window.electronAPI?.mcpServers;
    if (!api) return null;
    return {
      list: (...args) => api.list(...args),
      create: (...args) => api.create(...args),
      delete: (...args) => api.delete(...args),
      reconnect: (...args) => api.reconnect(...args),
      test: (...args) => api.test(...args),
      testExisting: (...args) => api.testExisting(...args),
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1000px] px-6 py-7 sm:px-8 sm:py-8">
        {desktopMcpApi ? (
          <QueryClientProvider client={queryClient}>
            <McpServersApiProvider api={desktopMcpApi}>
              <McpIntegrationsLanding
                title="Integrations"
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
