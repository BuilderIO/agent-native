import {
  AgentChatMemoryRouter as MemoryRouter,
  AgentSidebar,
} from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { DESKTOP_LOCAL_CODE_CHANGE_EVENT } from "@agent-native/core/client/chat";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  IconAlertCircle,
  IconArrowUpRight,
  IconCircleCheck,
  IconLoader2,
  IconLock,
} from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  DesktopAppRuntimeStatus,
  DesktopPrepareLocalCodeChangeResult,
} from "@shared/ipc-channels";

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

type DesktopChatModelGroup = {
  engine: string;
  label: string;
  models: string[];
  configured: boolean;
  statusLabel?: string;
  isSubscription?: boolean;
};

function desktopModelProviderLabel(model: CodeAgentModelOption): string {
  const normalizedModel = model.model.toLowerCase();
  if (
    model.engine === "codex-cli" ||
    normalizedModel.startsWith("gpt-") ||
    normalizedModel.startsWith("openai/gpt-")
  ) {
    return "OpenAI";
  }
  if (normalizedModel.startsWith("claude-")) return "Anthropic";
  if (normalizedModel.startsWith("gemini-")) return "Gemini";
  return model.engineLabel;
}

export interface DesktopAppChatShellProps {
  appId: string;
  appName: string;
  children: ReactNode;
  authState?: AppWebviewAuthState;
  onSignInRequest?: () => void;
  onLocalCodeChangeStarted?: (
    result: DesktopPrepareLocalCodeChangeResult,
  ) => void;
}

type LocalCodeChangeState =
  | { status: "idle" }
  | { status: "starting"; message?: string }
  | { status: "ready" }
  | { status: "error"; message: string };

export default function DesktopAppChatShell({
  appId,
  appName,
  children,
  authState = "unknown",
  onSignInRequest,
  onLocalCodeChangeStarted,
}: DesktopAppChatShellProps) {
  const shellRootRef = useRef<HTMLDivElement>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [localAgentModels, setLocalAgentModels] = useState<
    CodeAgentModelOption[]
  >([]);
  const [localAgentModelsLoading, setLocalAgentModelsLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState("default");
  const [localCodeChangePrompt, setLocalCodeChangePrompt] = useState("");
  const [localCodeChange, setLocalCodeChange] =
    useState<LocalCodeChangeState>({ status: "idle" });

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
    setLocalAgentModelsLoading(true);
    const listModels = window.electronAPI?.codeAgents?.listModels;
    if (!listModels) {
      setLocalAgentModelsLoading(false);
      return () => undefined;
    }
    void listModels()
      .then((result) => {
        if (!cancelled) setLocalAgentModels(result.models);
      })
      .catch(() => {
        if (!cancelled) setLocalAgentModels([]);
      })
      .finally(() => {
        if (!cancelled) setLocalAgentModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const availableModels = useMemo<DesktopChatModelGroup[]>(() => {
    const groups = new Map<string, DesktopChatModelGroup>();
    for (const model of localAgentModels) {
      const modelId = model.model.trim();
      if (!modelId || modelId === "auto") continue;
      const label = desktopModelProviderLabel(model);
      const key = `${model.engine}:${label}`;
      const existing = groups.get(key);
      if (existing) {
        if (!existing.models.includes(modelId)) existing.models.push(modelId);
        existing.configured ||= model.configured === true;
        if (!existing.statusLabel && model.statusLabel) {
          existing.statusLabel = model.statusLabel;
        }
        existing.isSubscription ||= model.isSubscription === true;
        continue;
      }
      groups.set(key, {
        engine: model.engine,
        label,
        models: [modelId],
        configured: model.configured === true,
        ...(model.statusLabel ? { statusLabel: model.statusLabel } : {}),
        ...(model.isSubscription ? { isSubscription: true } : {}),
      });
    }
    return [...groups.values()];
  }, [localAgentModels]);

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
          availableModels={
            localAgentModelsLoading || localAgentModels.length > 0
              ? availableModels
              : undefined
          }
          modelListLoading={localAgentModelsLoading}
          runtime={localRuntime}
        >
          {appSurface}
        </AgentSidebar>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
