import {
  AgentChatSurface,
  closeChatFirstSessionWatch,
  useChatFirstSessionWatch,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconEye, IconX } from "@tabler/icons-react";
import { useMemo } from "react";

function threadPath(threadId: string | null): string {
  return threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
}

/**
 * Dispatch's leaf renderer for the shared session-watch contract. The target
 * thread stays route-owned by this pane, so watching never moves the main
 * chat's URL or active thread.
 */
export function ChatFirstSessionWatchPane({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const { target } = useChatFirstSessionWatch();
  const threadUrlSync = useMemo(
    () =>
      target
        ? {
            routeThreadId: target.sessionId,
            getPath: threadPath,
            navigate: () => undefined,
          }
        : false,
    [target],
  );

  if (!target) return null;

  const content = (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <IconEye
          size={16}
          className="shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {t("dispatch.pages.chatFirstWatchingSession", {
              name: target.title || t("dispatch.pages.chatFirstSession"),
            })}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {target.sessionId}
          </p>
        </div>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("dispatch.pages.chatFirstStopWatchingSession")}
          title={t("dispatch.pages.chatFirstStopWatching")}
          onClick={onClose ?? closeChatFirstSessionWatch}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <AgentChatSurface
          mode="page"
          className="h-full min-h-0 w-full"
          defaultMode="chat"
          storageKey={`dispatch-session-watch:${target.sessionId}`}
          restoreActiveThread={false}
          threadUrlSync={threadUrlSync}
          showHeader={false}
          showTabBar={false}
          showPageNewChatButton={false}
          chatOnly
          dynamicSuggestions={false}
          suggestions={[]}
          emptyStateDisplay="hidden"
          composerPlaceholder={t(
            "dispatch.pages.chatFirstSessionMessagePlaceholder",
          )}
        />
      </div>
    </>
  );

  return embedded ? (
    <div
      data-dispatch-chat-first-watch-pane
      className="flex h-full min-h-0 w-full flex-col"
      aria-label={t("dispatch.pages.chatFirstWatchedSession")}
    >
      {content}
    </div>
  ) : (
    <aside
      data-dispatch-chat-first-watch-pane
      className="dispatch-chat-first-session-watch flex min-w-[320px] min-h-0 w-[40%] shrink-0 flex-col border-s border-border bg-background"
      aria-label={t("dispatch.pages.chatFirstWatchedSession")}
    >
      {content}
    </aside>
  );
}
