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

  const startLocalCodeChange = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || localCodeChange.status === "starting") return;

      setLocalCodeChangePrompt(trimmed);
      setLocalCodeChange({
        status: "starting",
        message: `Preparing ${appName} in a local workspace.`,
      });
      const prepare = window.electronAPI?.appConfig?.prepareLocalCodeChange;
      if (!prepare) {
        setLocalCodeChange({
          status: "error",
          message: "Local code setup is unavailable in this Desktop session.",
        });
        return;
      }

      try {
        const result = await prepare({ appId, prompt: trimmed });
        if (!result.ok) {
          throw new Error(result.error ?? result.message);
        }
        onLocalCodeChangeStarted?.(result);
        setLocalCodeChange({
          status: "starting",
          message: `Cloning the template and applying your change in ${appName}.`,
        });
      } catch (error) {
        setLocalCodeChange({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Desktop could not prepare the local app.",
        });
      }
    },
    [appId, appName, localCodeChange.status, onLocalCodeChangeStarted],
  );

  useEffect(() => {
    const shellRoot = shellRootRef.current;
    if (!shellRoot) return;
    const handleLocalCodeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: unknown }>).detail;
      const prompt = typeof detail?.prompt === "string" ? detail.prompt : "";
      if (!prompt || localCodeChange.status === "starting") return;
      event.stopPropagation();
      void startLocalCodeChange(prompt);
    };
    shellRoot.addEventListener(
      DESKTOP_LOCAL_CODE_CHANGE_EVENT,
      handleLocalCodeChange,
    );
    return () => {
      shellRoot.removeEventListener(
        DESKTOP_LOCAL_CODE_CHANGE_EVENT,
        handleLocalCodeChange,
      );
    };
  }, [localCodeChange.status, startLocalCodeChange]);

  useEffect(() => {
    if (localCodeChange.status === "idle") return;
    const onRuntimeStatus = window.electronAPI?.appConfig?.onRuntimeStatus;
    if (!onRuntimeStatus) return;
    return onRuntimeStatus((status: DesktopAppRuntimeStatus) => {
      if (status.appId !== appId) return;
      if (status.state === "waiting" || status.state === "starting") {
        setLocalCodeChange({
          status: "starting",
          message: status.message,
        });
        return;
      }
      if (status.state === "running") {
        setLocalCodeChange({ status: "ready" });
        return;
      }
      if (status.state === "error" || status.state === "stopped") {
        setLocalCodeChange({
          status: "error",
          message: status.message ?? `The local ${appName} preview stopped.`,
        });
      }
    });
  }, [appId, appName, localCodeChange.status]);

  useEffect(() => {
    if (localCodeChange.status !== "ready") return;
    const timer = window.setTimeout(
      () => setLocalCodeChange({ status: "idle" }),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [localCodeChange.status]);

  const closeLocalCodeChangeDialog = useCallback(() => {
    if (localCodeChange.status === "starting") return;
    setLocalCodeChange({ status: "idle" });
  }, [localCodeChange.status]);

  const appSurface = (
    <div className="desktop-app-webview-surface relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );

  const localCodeChangeDialog = (
    <Dialog
      open={localCodeChange.status !== "idle"}
      onOpenChange={(open) => {
        if (!open) closeLocalCodeChangeDialog();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {localCodeChange.status === "error"
              ? `Couldn’t start ${appName} locally`
              : localCodeChange.status === "ready"
                ? `${appName} is ready locally`
                : `Preparing ${appName} locally`}
          </DialogTitle>
          <DialogDescription>
            {localCodeChange.status === "error"
              ? localCodeChange.message
              : localCodeChange.status === "ready"
                ? "The app is now running from your local code."
                : localCodeChange.status === "starting"
                  ? localCodeChange.message ??
                    "Cloning the template, installing dependencies, and applying your request."
                  : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-3 text-sm">
          {localCodeChange.status === "error" ? (
            <IconAlertCircle className="size-5 shrink-0 text-destructive" />
          ) : localCodeChange.status === "ready" ? (
            <IconCircleCheck className="size-5 shrink-0 text-emerald-600" />
          ) : (
            <IconLoader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className="text-muted-foreground">
            {localCodeChange.status === "error"
              ? "You can close this and keep working in the current app."
              : localCodeChange.status === "ready"
                ? "Continue prompting to customize the local app."
                : "This usually takes a moment."}
          </span>
        </div>
        {localCodeChange.status === "error" ? (
          <DialogFooter>
            <Button variant="outline" onClick={closeLocalCodeChangeDialog}>
              Close
            </Button>
            {localCodeChangePrompt ? (
              <Button
                onClick={() => void startLocalCodeChange(localCodeChangePrompt)}
              >
                Try again
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );

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
    <div
      ref={shellRootRef}
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {apiUrl ? (
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
      ) : (
        appSurface
      )}
      {localCodeChangeDialog}
    </div>
  );
}
