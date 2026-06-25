import {
  AgentChatSurface,
  appBasePath,
  appPath,
  markAgentChatHomeHandoff,
} from "@agent-native/core/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { submitOverviewPrompt } from "@/lib/overview-chat";

function chatThreadPath(threadId: string | null): string {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
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

interface DispatchChatLocationState {
  dispatchPrompt?: {
    id?: string | number;
    message?: string;
    selectedModel?: string | null;
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
  const location = useLocation();
  const navigate = useNavigate();
  const routeThreadId = threadIdFromPath(location.pathname);
  const handledStateIds = useRef(new Set<string>());

  const navigateThreadUrl = useCallback(
    (path: string, options?: { replace?: boolean }) =>
      navigate(dispatchNavTarget(path), options),
    [navigate],
  );
  const threadUrlSync = useMemo<DispatchThreadUrlSync>(
    () => ({
      routeThreadId: routeThreadId ?? null,
      getPath: chatThreadPath,
      navigate: navigateThreadUrl,
    }),
    [routeThreadId, navigateThreadUrl],
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DispatchAgentChatSurface
        mode="page"
        chatViewTransition
        className="dispatch-chat-panel"
        defaultMode="chat"
        storageKey="dispatch"
        threadUrlSync={threadUrlSync}
        showHeader={false}
        showTabBar={false}
        dynamicSuggestions={false}
        suggestions={[]}
        emptyStateText="Ask Dispatch to create apps, route work, or manage the workspace."
        emptyStateDisplay="hidden"
        centerComposerWhenEmpty
        composerLayoutVariant="hero"
        composerPlaceholder="Ask Dispatch..."
        composerSlot={
          <div className="dispatch-chat-intro">
            <h1>What should Dispatch do next?</h1>
            <p>
              Create apps, manage shared keys, and route work across agents.
            </p>
          </div>
        }
      />
    </div>
  );
}
