import { useEffect, useRef } from "react";
import {
  useLocation,
  useNavigate,
  type LoaderFunctionArgs,
} from "react-router";
import { AgentChatSurface } from "@agent-native/core/client";
import { submitOverviewPrompt } from "@/lib/overview-chat";
import {
  buildThreadLinkPreviewMeta,
  loadThreadLinkPreview,
} from "@/server/lib/thread-link-preview";

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

export async function loader({ request }: LoaderFunctionArgs) {
  const threadId = new URL(request.url).searchParams.get("thread");
  return {
    threadPreview: await loadThreadLinkPreview(threadId),
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  return data?.threadPreview
    ? buildThreadLinkPreviewMeta(data.threadPreview)
    : [{ title: "Chat — Dispatch" }];
}

export default function ChatRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const handledStateIds = useRef(new Set<string>());
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AgentChatSurface
        mode="page"
        className="dispatch-chat-panel"
        defaultMode="chat"
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
