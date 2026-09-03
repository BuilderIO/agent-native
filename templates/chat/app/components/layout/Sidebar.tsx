import { AgentNativeIcon } from "@agent-native/core/client/agent-native-icon";
import {
  navigateWithAgentChatViewTransition,
  useAgentChatRunningThreads,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agentkit-chat/rail";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org-switcher";
import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistorySection,
} from "@agent-native/toolkit/chat-history/ChatHistoryList";
import {
  IconApps,
  IconClock,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLoader2,
  IconMessages,
  IconPin,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { visibleChatThreads } from "@/lib/sidebar-thread-state";
import { cn } from "@/lib/utils";

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function threadTitle(thread: ChatThreadSummary, untitledLabel: string) {
  return thread.title || thread.preview || untitledLabel;
}

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function compareRecentThreads(a: ChatThreadSummary, b: ChatThreadSummary) {
  return threadUpdatedAt(b) - threadUpdatedAt(a);
}

function comparePinnedThreads(a: ChatThreadSummary, b: ChatThreadSummary) {
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
}

function formatRelativeTime(timestamp: number) {
  const elapsed = timestamp - Date.now();
  const intervals = [
    { limit: 60, divisor: 1, unit: "second" },
    { limit: 60, divisor: 60, unit: "minute" },
    { limit: 24, divisor: 60 * 60, unit: "hour" },
    { limit: 7, divisor: 60 * 60 * 24, unit: "day" },
    { limit: 5, divisor: 60 * 60 * 24 * 7, unit: "week" },
    { limit: 12, divisor: 60 * 60 * 24 * 30, unit: "month" },
  ] as const;
  const elapsedSeconds = elapsed / 1000;

  for (const interval of intervals) {
    const value = elapsedSeconds / interval.divisor;
    if (Math.abs(value) < interval.limit) {
      return new Intl.RelativeTimeFormat(undefined, {
        numeric: "auto",
        style: "narrow",
      }).format(Math.round(value), interval.unit);
    }
  }

  return new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
    style: "narrow",
  }).format(Math.round(elapsedSeconds / (60 * 60 * 24 * 365)), "year");
}

function ThreadHistoryTitle({
  thread,
  title,
  running,
}: {
  thread: ChatThreadSummary;
  title: string;
  running: boolean;
}) {
  const t = useT();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const updatedAt = threadUpdatedAt(thread);
  const contextLabels = Array.from(
    new Set(
      [
        thread.scope?.label,
        thread.scope?.type !== "general" ? thread.scope?.type : null,
        thread.source?.appId,
        thread.source?.platform,
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const overflow = Math.max(0, content.scrollWidth - viewport.clientWidth);
      const overflowing = overflow > 1;
      setIsOverflowing(overflowing);
      content.style.setProperty("--chat-sidebar-title-shift", `${overflow}px`);
      content.style.setProperty(
        "--chat-sidebar-title-duration",
        `${Math.max(1800, overflow * 24)}ms`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [title]);

  return (
    <HoverCard openDelay={500} closeDelay={120}>
      <HoverCardTrigger asChild>
        <span className="chat-sidebar-thread-title-shell">
          <span
            ref={viewportRef}
            className="chat-sidebar-thread-title"
            data-overflow={isOverflowing ? "true" : "false"}
          >
            <span
              ref={contentRef}
              className="chat-sidebar-thread-title__content"
            >
              {title}
            </span>
          </span>
          {running ? (
            <IconLoader2
              className="chat-sidebar-thread-running size-3.5 shrink-0 motion-safe:animate-spin"
              strokeWidth={1.8}
              role="status"
              aria-label={t(
                // i18n-key-ignore shared framework catalog
                "agentChat.status.working",
              )}
            />
          ) : null}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        className="chat-sidebar-thread-details w-80 rounded-xl p-3"
      >
        <div className="line-clamp-3 text-sm font-medium leading-snug">
          {title}
        </div>
        {thread.preview && thread.preview !== title ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {thread.preview}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {updatedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="size-3.5" strokeWidth={1.8} />
              <time dateTime={new Date(updatedAt).toISOString()}>
                {formatRelativeTime(updatedAt)}
              </time>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <IconMessages className="size-3.5" strokeWidth={1.8} />
            <span>{thread.messageCount.toLocaleString()}</span>
            <span className="sr-only">{t("chat.chats")}</span>
          </span>
          {thread.pinnedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <IconPin className="size-3.5" strokeWidth={1.8} />
              {t("chat.pinned")}
            </span>
          ) : null}
        </div>
        {contextLabels.length > 0 ? (
          <div className="mt-2.5 flex items-start gap-1.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
            <IconApps className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} />
            <span className="min-w-0 break-words">
              {contextLabels.join(" · ")}
            </span>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

function persistedActiveThreadId() {
  try {
    return localStorage.getItem(CHAT_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string) {
  try {
    localStorage.setItem(CHAT_ACTIVE_THREAD_KEY, threadId);
  } catch {}
}

function threadIdFromPath(pathname: string) {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
  } catch {
    return null;
  }
}

function chatThreadPath(threadId: string) {
  return `/chat/${encodeURIComponent(threadId)}`;
}

function ChatThreadsSection({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });
  const { workingThreadIds, observedThreadStarts } =
    useAgentChatRunningThreads();

  const visibleThreads = useMemo(
    () => visibleChatThreads(threads, observedThreadStarts),
    [observedThreadStarts, threads],
  );
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    activeThreadId ??
    persistedActiveThreadId();

  const historySections = useMemo<ChatHistorySection[]>(() => {
    const untitledLabel = t("chat.untitledChat");
    const toItem = (thread: ChatThreadSummary): ChatHistoryItem => {
      const title = threadTitle(thread, untitledLabel);
      return {
        id: thread.id,
        title: (
          <ThreadHistoryTitle
            thread={thread}
            title={title}
            running={workingThreadIds.has(thread.id)}
          />
        ),
        titleText: title,
        pinned: Boolean(thread.pinnedAt),
      };
    };
    const pinned = visibleThreads
      .filter((thread) => Boolean(thread.pinnedAt))
      .sort(comparePinnedThreads)
      .map(toItem);
    const recent = visibleThreads
      .filter((thread) => !thread.pinnedAt)
      .sort(compareRecentThreads)
      .slice(0, 30)
      .map(toItem);

    return [
      { id: "pinned", label: t("chat.pinned"), items: pinned },
      { id: "recents", label: t("chat.recents"), items: recent },
    ];
  }, [t, visibleThreads, workingThreadIds]);

  useEffect(() => {
    const refresh = () => refreshThreads();
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { isRunning?: unknown }
        | undefined;
      if (typeof detail?.isRunning === "boolean") refreshThreads();
    };

    window.addEventListener("agent-chat:threads-updated", refresh);
    window.addEventListener("agentNative.chatRunning", handleRunning);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("agent-chat:threads-updated", refresh);
      window.removeEventListener("agentNative.chatRunning", handleRunning);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshThreads]);

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    persistActiveThreadId(threadId);
    if (options?.isNew) {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: true },
        }),
      );
    }
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
    if (options?.isNew) return;
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: false },
        }),
      );
    });
  }

  async function handleNewChat() {
    const threadId = await createThread();
    if (threadId) openThread(threadId, { isNew: true });
  }

  async function handleArchiveThread(threadId: string) {
    const wasActive =
      threadId === activeThreadId || threadId === persistedActiveThreadId();
    const archived = await archiveThread(threadId);
    if (!archived) {
      toast.error(t("chat.archiveFailed"));
      return;
    }
    if (wasActive) await handleNewChat();
  }

  function handleRenameThread(threadId: string, title: string) {
    void renameThread(threadId, title).then((renamed) => {
      if (!renamed) toast.error(t("chat.renameFailed"));
    });
  }

  const newChatButton = (
    <button
      type="button"
      onClick={() => void handleNewChat()}
      className={cn(
        "flex items-center text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        collapsed
          ? "size-10 justify-center rounded-md"
          : "h-10 w-full gap-3 rounded-lg px-3 text-sm font-medium",
      )}
      aria-label={collapsed ? t("chat.newChat") : undefined}
    >
      <IconEdit className="size-4 shrink-0" strokeWidth={1.8} />
      <span className={collapsed ? "sr-only" : "truncate"}>
        {t("chat.newChat")}
      </span>
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{newChatButton}</TooltipTrigger>
        <TooltipContent side="right">{t("chat.newChat")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-3">{newChatButton}</div>
      <ChatHistoryList
        sections={historySections}
        activeId={displayedActiveThreadId}
        onSelect={openThread}
        onTogglePin={(threadId) => {
          const thread = visibleThreads.find((item) => item.id === threadId);
          if (thread) void pinThread(threadId, !thread.pinnedAt);
        }}
        onRename={handleRenameThread}
        renameMaxLength={160}
        onDelete={(threadId) => void handleArchiveThread(threadId)}
        labels={{
          options: (item) =>
            t("chat.optionsFor", { title: item.titleText ?? "" }),
          renameInput: (item) =>
            t("chat.renameThread", { title: item.titleText ?? "" }),
          rename: t("chat.renameChat"),
          pin: t("chat.pinChat"),
          unpin: t("chat.unpinChat"),
          delete: t("chat.archiveChat"),
        }}
        variant="rail"
        emptyLabel={null}
        className="chat-sidebar-history min-h-0 flex-1"
        listClassName="pb-4"
      />
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const t = useT();
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" strokeWidth={1.8} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={t("root.commandSearch")}
          className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <IconSearch className="size-4" strokeWidth={1.8} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("root.commandSearch")}</TooltipContent>
    </Tooltip>
  );
  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-full",
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center",
          collapsed ? "justify-center px-1" : "gap-1 px-3",
        )}
      >
        {collapsed ? (
          collapseButton
        ) : (
          <>
            <Link
              to="/"
              className="flex min-w-0 flex-1 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <AgentNativeIcon
                aria-hidden="true"
                className="h-3.5 w-6 shrink-0 text-sidebar-accent-foreground"
              />
              <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">
                {APP_TITLE}
              </span>
            </Link>
            {searchButton}
            {collapseButton}
          </>
        )}
      </div>

      <nav
        aria-label={t("navigation.navigation")}
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          collapsed ? "items-center gap-1 px-1 py-2" : "pt-1",
        )}
      >
        <ChatThreadsSection collapsed={collapsed} />
        {collapsed ? searchButton : null}
      </nav>

      <div className="mt-auto shrink-0 p-2">
        <OrgSwitcher
          reserveSpace
          compact={collapsed}
          currentAppId="chat"
          className={
            collapsed
              ? "size-8 bg-transparent p-0 hover:bg-sidebar-accent"
              : "h-11 rounded-lg bg-transparent px-3 py-2 text-sm text-sidebar-accent-foreground hover:bg-sidebar-accent"
          }
        />
      </div>
    </aside>
  );
}
