import {
  AgentChatMemoryRouter as MemoryRouter,
  AgentSidebar,
} from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { IconArrowUpRight, IconLock } from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  installDesktopChatFetchRelay,
  setDesktopChatRelayBase,
} from "../lib/desktop-chat-relay.js";
import {
  DESKTOP_LOCAL_AGENT_ENGINE_BY_ID,
  DESKTOP_LOCAL_AGENT_OPTIONS,
  createDesktopLocalAgentRuntime,
  type DesktopLocalAgentId,
} from "../lib/desktop-local-agent-runtime.js";
import type { AppWebviewAuthState } from "./AppWebview.js";

const desktopChatQueryClient = createAgentNativeQueryClient();

export interface DesktopAppChatShellProps {
  appId: string;
  appName: string;
  children: ReactNode;
  authState?: AppWebviewAuthState;
  onSignInRequest?: () => void;
}

export default function DesktopAppChatShell({
  appId,
  appName,
  children,
  authState = "unknown",
  onSignInRequest,
}: DesktopAppChatShellProps) {
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [localAgentModels, setLocalAgentModels] = useState<
    Array<{
      engine: string;
      configured?: boolean;
      statusLabel?: string;
    }>
  >([]);
  const [selectedAgent, setSelectedAgent] = useState("default");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`desktop-app-agent:${appId}`);
      if (stored) setSelectedAgent(stored);
      // coercion-ok: localStorage is optional renderer state; the explicit default remains active.
    } catch {
      // Keep the default agent when storage is unavailable.
    }
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    const listModels = window.electronAPI?.codeAgents?.listModels;
    if (!listModels) return () => undefined;
    void listModels()
      .then((result) => {
        if (!cancelled) setLocalAgentModels(result.models);
      })
      .catch(() => {
        if (!cancelled) setLocalAgentModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const availableAgents = useMemo(
    () =>
      DESKTOP_LOCAL_AGENT_OPTIONS.map((agent) => {
        if (agent.id === "default") return agent;
        const engine =
          DESKTOP_LOCAL_AGENT_ENGINE_BY_ID[agent.id as DesktopLocalAgentId];
        const model = localAgentModels.find((item) => item.engine === engine);
        return {
          ...agent,
          configured: model?.configured === true,
          statusLabel:
            model?.statusLabel ?? (model ? "Sign in" : "Not installed"),
        };
      }),
    [localAgentModels],
  );

  const handleAgentChange = useCallback(
    (agent: string) => {
      const option = availableAgents.find((item) => item.id === agent);
      if (!option || option.configured === false) return;
      setSelectedAgent(agent);
      try {
        localStorage.setItem(`desktop-app-agent:${appId}`, agent);
        // coercion-ok: localStorage is optional renderer state; this mount already has the selection.
      } catch {
        // The selection still applies for this mount when storage is unavailable.
      }
    },
    [appId, availableAgents],
  );

  const handleLocalRuntimeSetup = useCallback((agent: string) => {
    if (agent === "codex") {
      void window.electronAPI?.codeAgents?.openCodexLogin();
      return;
    }
    void window.electronAPI?.codeAgents?.openTerminal();
  }, []);

  const localAgentId =
    selectedAgent === "default"
      ? undefined
      : (selectedAgent as DesktopLocalAgentId);
  const localRuntime = useMemo(
    () =>
      localAgentId ? createDesktopLocalAgentRuntime(localAgentId) : undefined,
    [localAgentId],
  );

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

  const signInPrompt =
    authState === "unauthenticated" ? (
      <div className="flex shrink-0 items-center px-3 pb-1">
        <button
          type="button"
          data-desktop-app-sign-in
          aria-label={`Sign in to ${appName} on the right`}
          title={`Sign in to ${appName} on the right`}
          onClick={onSignInRequest}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <IconLock size={12} stroke={1.8} />
          <span>Sign in on the right</span>
          <IconArrowUpRight size={12} stroke={1.8} />
        </button>
      </div>
    ) : null;

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
          composerSlot={signInPrompt}
          showTabBar
          suppressInlineOpenApp
          dynamicSuggestions={false}
          suggestions={[]}
          emptyStateText={`Ask about ${appName}`}
          availableAgents={availableAgents}
          selectedAgent={selectedAgent}
          onAgentChange={handleAgentChange}
          onConnectLocalRuntime={handleLocalRuntimeSetup}
          runtime={localRuntime}
        >
          {appSurface}
        </AgentSidebar>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
