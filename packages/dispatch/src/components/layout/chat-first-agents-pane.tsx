import {
  ChatFirstAgentActivityPanel,
  emitChatFirstSessionWatch,
  type ChatFirstAgentActivity,
} from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconUsersGroup } from "@tabler/icons-react";

interface DispatchAgentThread {
  id: string;
  title: string;
  preview?: string;
  snippet?: string;
  updatedAt?: number;
}

interface SearchAgentThreadsResult {
  threads: DispatchAgentThread[];
}

function toActivity(
  thread: DispatchAgentThread,
  t: (key: string, options?: Record<string, unknown>) => string,
): ChatFirstAgentActivity {
  return {
    sessionId: thread.id,
    title: thread.title || t("dispatch.pages.chatFirstUntitledAgentSession"),
    subtitle:
      thread.snippet ||
      thread.preview ||
      t("dispatch.pages.chatFirstAgentChatSession"),
    status: "recent",
    ...(thread.updatedAt ? { updatedAt: thread.updatedAt } : {}),
  };
}

export function ChatFirstAgentsPane() {
  const t = useT();
  const query = useActionQuery<SearchAgentThreadsResult>(
    "search-agent-threads",
    { sourceId: "current", limit: 12 },
  );
  const activities = (query.data?.threads ?? []).map((thread) =>
    toActivity(thread, t),
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-background"
      data-dispatch-chat-first-agents-pane
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <IconUsersGroup size={16} className="text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">
          {t("dispatch.pages.chatFirstAgentsTitle")}
        </span>
      </div>
      <ChatFirstAgentActivityPanel
        activities={activities}
        loading={query.isLoading}
        error={query.isError ? query.error.message : null}
        onRefresh={() => void query.refetch()}
        onWatch={(activity) =>
          emitChatFirstSessionWatch({
            sessionId: activity.sessionId,
            title: activity.title,
            kind: "agent-chat",
          })
        }
      />
    </div>
  );
}
