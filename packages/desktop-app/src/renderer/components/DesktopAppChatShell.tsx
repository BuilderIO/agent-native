import {
  AgentChatMemoryRouter as MemoryRouter,
  AgentSidebar,
} from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import {
  installDesktopChatFetchRelay,
  setDesktopChatRelayBase,
} from "../lib/desktop-chat-relay.js";

const desktopChatQueryClient = createAgentNativeQueryClient();

export interface DesktopAppChatShellProps {
  appId: string;
  appName: string;
  children: ReactNode;
}

export default function DesktopAppChatShell({
  appId,
  appName,
  children,
}: DesktopAppChatShellProps) {
  const [apiUrl, setApiUrl] = useState<string | null>(null);

  installDesktopChatFetchRelay();

  useEffect(() => {
    let cancelled = false;
    setApiUrl(null);
    setDesktopChatRelayBase(null);

    const getApiUrl = window.electronAPI?.desktopChat?.getApiUrl;
    if (!getApiUrl) return () => undefined;

    void getApiUrl(appId)
      .then((nextApiUrl) => {
        if (cancelled) return;
        setDesktopChatRelayBase(nextApiUrl);
        setApiUrl(nextApiUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setDesktopChatRelayBase(null);
        setApiUrl(null);
      });

    return () => {
      cancelled = true;
      setDesktopChatRelayBase(null);
    };
  }, [appId]);

  const appSurface = (
    <div className="desktop-app-webview-surface relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );

  if (!apiUrl) return appSurface;

  return (
    <MemoryRouter>
      <QueryClientProvider client={desktopChatQueryClient}>
        <AgentSidebar
          position="left"
          defaultOpen
          openStorageKey="desktop-app-chat"
          storageKey={`desktop-app-chat:${appId}`}
          scope={{
            type: "desktop-app",
            id: appId,
            label: appName,
            contextKey: `desktop-app:${appId}`,
          }}
          apiUrl={apiUrl}
          agentChatSurface="desktop"
          showTabBar
          suppressInlineOpenApp
          dynamicSuggestions={false}
          suggestions={[]}
          emptyStateText={`Ask about ${appName}`}
        >
          {appSurface}
        </AgentSidebar>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
