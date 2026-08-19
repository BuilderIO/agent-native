import {
  AgentChatSurface,
  insertAgentComposerReference,
  markAgentChatHomeHandoff,
  readChatFirstMode,
} from "@agent-native/core/client/agent-chat";
import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { ActionQueryError } from "../../components/action-query-error";
import { useDispatchExtensions } from "../../components/layout/Layout";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { submitOverviewPrompt } from "../../lib/overview-chat";

interface WorkspaceAgentResource {
  id: string;
  name: string;
  description: string | null;
  path: string;
  content: string;
  scope: "all" | "selected";
  updatedAt: number;
}

function chatThreadPath(threadId: string | null, agentPath?: string): string {
  const path = threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
  return agentPath ? `${path}?agent=${encodeURIComponent(agentPath)}` : path;
}

function stripBasePath(pathname: string): string {
  const basePath = appBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

// The chat surface renders for both `/chat` and the `/chat/:threadId` deep
// link. The thread id is read from the pathname (not `useParams`) because the
// param is owned by the nested deep-link route, not this leaf component.
function threadIdFromPath(pathname: string): string | null {
  const match = stripBasePath(pathname).match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

// Mirror the basename handling Dispatch's nav links use: pass a router-local
// path when the live URL is already under the mount, otherwise prefix it.
function dispatchNavTarget(path: string): string {
  if (typeof window === "undefined") return path;
  const basePath = appBasePath();
  if (!basePath) return path;
  const pathname = window.location.pathname;
  const routerHasBasename =
    pathname === basePath || pathname.startsWith(`${basePath}/`);
  return routerHasBasename ? path : appPath(path);
}

interface DispatchThreadUrlSync {
  routeThreadId: string | null;
  getPath: (threadId: string | null) => string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

type DispatchAgentChatSurfaceProps = ComponentProps<typeof AgentChatSurface> & {
  threadUrlSync?: DispatchThreadUrlSync;
};

function DispatchAgentChatSurface(props: DispatchAgentChatSurfaceProps) {
  return <AgentChatSurface {...props} />;
}

function DispatchRequestIdButton({ requestId }: { requestId: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void writeClipboardText(requestId).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  }, [requestId]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={t("dispatch.pages.copyRequestId", {
        defaultValue: "Copy request ID",
      })}
    >
      {copied ? (
        <IconCheck aria-hidden="true" />
      ) : (
        <IconCopy aria-hidden="true" />
      )}
      {copied
        ? t("dispatch.pages.copied", { defaultValue: "Copied" })
        : t("dispatch.pages.copyRequestId", {
            defaultValue: "Copy request ID",
          })}
    </Button>
  );
}

interface DispatchChatLocationState {
  dispatchPrompt?: {
    id?: string | number;
    message?: string;
    selectedModel?: string | null;
    selectedEngine?: string | null;
    selectedEffort?: ComponentProps<typeof AgentChatSurface>["selectedEffort"];
  };
  dispatchThread?: {
    id?: string | number;
    threadId?: string;
  };
}

export function meta() {
  return [{ title: "Chat — Dispatch" }];
}

export default function ChatRoute() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const routeThreadId = threadIdFromPath(location.pathname);
  const agentPath = new URLSearchParams(location.search).get("agent");
  const agentsQuery = useActionQuery<WorkspaceAgentResource[]>(
    "list-workspace-resources",
    { kind: "agent" },
    { enabled: Boolean(agentPath), staleTime: 30_000 },
  );
  const agent = useMemo(
    () =>
      agentPath
        ? (agentsQuery.data ?? []).find((resource) => {
            const profileId = resource.path
              .replace(/^agents\//, "")
              .replace(/\.md$/, "");
            return (
              resource.path === agentPath ||
              resource.id === agentPath ||
              profileId === agentPath
            );
          })
        : undefined,
    [agentPath, agentsQuery.data],
  );
  const agentScope = useMemo(
    () =>
      agent
        ? {
            type: "agent",
            id: agent.id,
            label: agent.name,
            contextKey: `dispatch-agent:${agent.id}`,
          }
        : null,
    [agent],
  );
  const handledStateIds = useRef(new Set<string>());
  const extensions = useDispatchExtensions();
  const suppressInlineOpenApp =
    extensions?.chatFirst === true ||
    readChatFirstMode() ||
    new URLSearchParams(location.search).get("chatFirst") === "1";

  const navigateThreadUrl = useCallback(
    (path: string, options?: { replace?: boolean }) =>
      navigate(dispatchNavTarget(path), options),
    [navigate],
  );
  const threadUrlSync = useMemo<DispatchThreadUrlSync>(
    () => ({
      routeThreadId: routeThreadId ?? null,
      getPath: (threadId) => chatThreadPath(threadId, agentPath ?? undefined),
      navigate: navigateThreadUrl,
    }),
    [agentPath, routeThreadId, navigateThreadUrl],
  );
  const state = location.state as DispatchChatLocationState | null;
  const prompt = state?.dispatchPrompt;
  const thread = state?.dispatchThread;

  useEffect(() => {
    const message = prompt?.message?.trim();
    const threadId = thread?.threadId?.trim();
    if (!message && !threadId) return;

    const stateId = String(
      prompt?.id ?? thread?.id ?? `${message ?? ""}:${threadId ?? ""}`,
    );
    if (handledStateIds.current.has(stateId)) return;
    handledStateIds.current.add(stateId);

    const timer = window.setTimeout(() => {
      if (threadId) {
        window.dispatchEvent(
          new CustomEvent("agent-chat:open-thread", {
            detail: { threadId },
          }),
        );
      }
      if (message) {
        submitOverviewPrompt(message, prompt?.selectedModel, {
          openSidebar: false,
          selectedEngine: prompt?.selectedEngine,
          selectedEffort: prompt?.selectedEffort,
        });
      }
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    prompt?.id,
    prompt?.message,
    prompt?.selectedModel,
    prompt?.selectedEngine,
    prompt?.selectedEffort,
    thread?.id,
    thread?.threadId,
  ]);

  useEffect(() => {
    function handleChatRunning(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.isRunning === true) markAgentChatHomeHandoff("dispatch");
    }

    window.addEventListener("agentNative.chatRunning", handleChatRunning);
    return () =>
      window.removeEventListener("agentNative.chatRunning", handleChatRunning);
  }, []);

  useEffect(() => {
    if (!agent) return;
    const timer = window.setTimeout(() => {
      insertAgentComposerReference(
        {
          label: agent.name,
          icon: "agent",
          source: "agent:custom",
          refType: "custom-agent",
          refId: agent.id,
          refPath: agent.path,
          slotKey: "dispatch-agent",
          slotLabel: "Agent",
        },
        { openSidebar: false },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agent?.id, agent?.name, agent?.path]);

  if (agentPath && agentsQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 bg-background px-4 py-6 sm:px-6">
        <Skeleton className="mx-auto h-6 w-48" />
        <Skeleton className="mx-auto h-12 w-full max-w-2xl" />
      </div>
    );
  }

  if (agentPath && agentsQuery.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background px-4">
        <ActionQueryError
          error={agentsQuery.error}
          onRetry={() => void agentsQuery.refetch()}
        />
      </div>
    );
  }

  if (agentPath && !agent) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        This agent is no longer available.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {threadUrlSync.routeThreadId ? (
        <div className="flex justify-end px-4 pt-4 sm:px-6">
          <DispatchRequestIdButton requestId={threadUrlSync.routeThreadId} />
        </div>
      ) : null}
      <DispatchAgentChatSurface
        key={agent ? `agent-${agent.id}` : "dispatch"}
        mode="page"
        chatViewTransition
        className="dispatch-chat-panel px-4 sm:px-6"
        defaultMode="chat"
        storageKey={agent ? `dispatch-agent-${agent.id}` : "dispatch"}
        scope={agentScope}
        threadUrlSync={threadUrlSync}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suppressInlineOpenApp={suppressInlineOpenApp}
        suggestions={[]}
        emptyStateText={t("dispatch.pages.chatAcrossAppsDescription", {
          defaultValue:
            "Route work, inspect status, or create something new from one place.",
        })}
        emptyStateDisplay="hidden"
        {...(!prompt?.message
          ? {
              centerComposerWhenEmpty: true,
              composerLayoutVariant: "hero" as const,
            }
          : {})}
        composerPlaceholder={
          agent
            ? `Ask ${agent.name}...`
            : t("dispatch.pages.chatPromptPlaceholder", {
                defaultValue: "Ask Dispatch...",
              })
        }
        composerSlot={
          agent ? (
            <div className="dispatch-chat-intro">
              <h1>{agent.name}</h1>
              {agent.description ? <p>{agent.description}</p> : null}
            </div>
          ) : !prompt?.message ? (
            <div className="dispatch-chat-intro">
              <h1>
                {t("dispatch.pages.chatAcrossApps", {
                  defaultValue: "Chat across your apps",
                })}
              </h1>
              <p>
                {t("dispatch.pages.chatAcrossAppsDescription", {
                  defaultValue:
                    "Route work, inspect status, or create something new from one place.",
                })}
              </p>
            </div>
          ) : null
        }
      />
    </div>
  );
}
