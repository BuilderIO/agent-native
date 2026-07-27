import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconHierarchy2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

const navItems = [
  {
    icon: IconMessageCircle,
    labelKey: "navigation.chat",
    href: "/",
    view: "chat",
  },
];

const bottomNavItems = [
  {
    icon: IconHierarchy2,
    labelKey: "settings.agentTitle",
    href: "/agent",
    view: "agent",
  },
  {
    icon: IconSettings,
    labelKey: "navigation.settings",
    href: "/settings",
    view: "settings",
  },
];

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function formatThreadAge(updatedAt: number) {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(updatedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function threadTitle(thread: ChatThreadSummary) {
  return thread.title || thread.preview || "Untitled chat";
}

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function compareThreads(a: ChatThreadSummary, b: ChatThreadSummary) {
  const aPinned = a.pinnedAt ?? 0;
  const bPinned = b.pinnedAt ?? 0;
  if (aPinned || bPinned) return bPinned - aPinned;
  return threadUpdatedAt(b) - threadUpdatedAt(a);
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

function ChatThreadsSection() {
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

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 15),
    [threads],
  );
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    (location.pathname === "/" ? null : activeThreadId);
  const chatItems = useMemo<ChatHistoryItem[]>(
    () =>
      visibleThreads.map((thread) => ({
        id: thread.id,
        title: threadTitle(thread),
        titleText: threadTitle(thread),
        timestamp:
          thread.id === displayedActiveThreadId
            ? undefined
            : formatThreadAge(threadUpdatedAt(thread)),
        pinned: Boolean(thread.pinnedAt),
      })),
    [displayedActiveThreadId, visibleThreads],
  );

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
    navigateWithAgentChatViewTransition(
      navigate,
      options?.isNew ? "/" : chatThreadPath(threadId),
    );
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: options?.isNew === true },
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
    if (wasActive) {
      await handleNewChat();
    }
  }

  function handleRenameThread(threadId: string, title: string) {
    void renameThread(threadId, title).then((renamed) => {
      if (!renamed) toast.error(t("chat.renameFailed"));
    });
  }

  return (
    <div className="mt-2 border-s border-sidebar-border/70 ps-3">
      <ChatHistoryRail
        items={chatItems}
        activeId={displayedActiveThreadId}
        onSelect={(threadId) => openThread(threadId)}
        onNewChat={() => void handleNewChat()}
        railLabels={{
          newChat: t("chat.newChat"),
          showMore: t("chat.chats"),
          showLess: t("chat.chats"),
        }}
        renameMaxLength={160}
        onTogglePin={(threadId) => {
          const thread = visibleThreads.find((item) => item.id === threadId);
          if (thread) void pinThread(threadId, !thread.pinnedAt);
        }}
        onRename={handleRenameThread}
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
        className="min-w-0"
      />
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isChatRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center text-sm transition-colors",
      collapsed
        ? "relative h-10 w-full justify-center rounded-none border-s-2 px-0"
        : "h-9 rounded-md gap-3 px-3",
      isActive
        ? collapsed
          ? "border-s-sidebar-accent-foreground/80 bg-sidebar-accent text-sidebar-accent-foreground"
          : "bg-sidebar-accent text-sidebar-accent-foreground"
        : collapsed
          ? "border-s-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
    );
  const collapseButton = collapsible ? (
    <Tooltip
      placement="right"
      content={
        collapsed
          ? t("navigation.expandSidebar")
          : t("navigation.collapseSidebar")
      }
      trigger={
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "size-8" : "size-7",
          )}
          aria-label={
            collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" />
        </button>
      }
    />
  ) : null;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "h-12 justify-center px-0" : "h-14 px-3",
        )}
      >
        <Link
          to="/"
          className={cn(
            "flex min-w-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "size-7 justify-center" : "flex-1 gap-3",
          )}
          aria-label={collapsed ? APP_TITLE : undefined}
        >
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto shrink-0 dark:block"
          />
          <div className={cn("min-w-0", collapsed && "sr-only")}>
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              {APP_TITLE}
            </p>
          </div>
        </Link>
      </div>

      <nav
        className={cn(
          "flex-1 overflow-y-auto",
          collapsed ? "px-0 py-2" : "px-2 py-3",
        )}
      >
        <div className={cn("grid", collapsed ? "gap-0" : "gap-1")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? isChatRoute
                : location.pathname.startsWith(item.href);
            const link = (
              <Link
                to={item.href}
                onClick={(event) => {
                  if (
                    item.href === "/" &&
                    !isChatRoute &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigateWithAgentChatViewTransition(navigate, "/");
                  }
                }}
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {t(item.labelKey)}
                </span>
              </Link>
            );
            return (
              <div key={item.href}>
                {collapsed ? (
                  <Tooltip
                    placement="right"
                    trigger={link}
                    content={t(item.labelKey)}
                  />
                ) : (
                  link
                )}
                {!collapsed && item.view === "chat" && isChatRoute ? (
                  <ChatThreadsSection />
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      <div className={cn("mt-auto shrink-0", collapsed && "py-2")}>
        <nav
          className={cn(
            "grid",
            collapsed ? "gap-0 px-1 py-1" : "gap-1 px-2 py-1",
          )}
        >
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            const link = (
              <Link
                to={item.href}
                className={navClass({ isActive })}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {t(item.labelKey)}
                </span>
              </Link>
            );
            return collapsed ? (
              <Tooltip
                key={item.href}
                placement="right"
                trigger={link}
                content={t(item.labelKey)}
              />
            ) : (
              <div key={item.href}>{link}</div>
            );
          })}
        </nav>

        <div className={cn(collapsed ? "px-1 py-1" : "px-3 py-2")}>
          <OrgSwitcher
            reserveSpace
            className={
              collapsed
                ? "h-8 justify-center px-0 [&>span]:sr-only [&>svg:last-child]:hidden"
                : undefined
            }
          />
        </div>

        {!collapsed ? (
          <div className="flex items-center justify-end gap-1 px-3 py-2">
            <FeedbackButton className="min-w-0 flex-1" side="right" />
            {collapseButton}
          </div>
        ) : collapseButton ? (
          <div className="flex justify-center px-1 py-1">{collapseButton}</div>
        ) : null}
      </div>
    </aside>
  );
}
