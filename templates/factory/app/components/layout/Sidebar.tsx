import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  AppSidebarNavItem,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";
import {
  IconGitPullRequest,
  IconHierarchy2,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { APP_TITLE } from "@/lib/app-config";

const navItems = [
  {
    icon: IconMessageCircle,
    labelKey: "navigation.chat",
    href: "/chat",
    view: "chat",
  },
  {
    icon: IconGitPullRequest,
    labelKey: "navigation.triage",
    href: "/factory",
    view: "factory",
  },
  {
    icon: IconHierarchy2,
    labelKey: "navigation.agents",
    href: "/agents",
    view: "agents",
  },
];

const bottomNavItems = [
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
    // coercion-ok: browser storage may be unavailable; no persisted thread is distinguishable from no saved selection.
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string) {
  try {
    localStorage.setItem(CHAT_ACTIVE_THREAD_KEY, threadId);
    // coercion-ok: persistence is best effort; the active thread remains usable for this session.
  } catch {}
}

function threadIdFromPath(pathname: string) {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
    // coercion-ok: malformed route input has no valid thread id and remains outside thread selection.
  } catch {
    return null;
  }
}

function chatThreadPath(threadId: string) {
  return `/chat/${encodeURIComponent(threadId)}`;
}

function ChatThreadsSection({ open }: { open: boolean }) {
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
    (location.pathname === "/chat" ? null : activeThreadId);
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
      options?.isNew ? "/chat" : chatThreadPath(threadId),
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
    <div
      className="an-chat-history-rail__collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
    >
      <div className="ms-4">
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
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: location.pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton
      variant={collapsed ? "icon" : "sidebar"}
      side="right"
      className={collapsed ? "!size-9 !p-0" : "w-full"}
    />
  );

  const orgSwitcher = (
    <OrgSwitcher
      compact={collapsed}
      reserveSpace
      className={
        collapsed
          ? "!size-9 !p-0 [&>svg]:!size-4 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
          : "min-w-0 flex-1 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
      }
    />
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={APP_TITLE}
      brandHref="/chat"
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
    >
      <AppSidebarNavItem
        to="/chat"
        label={t("navigation.chat")}
        icon={IconMessageCircle}
        active={isChatRoute}
        onClick={(event) => {
          if (
            !isChatRoute &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            navigateWithAgentChatViewTransition(navigate, "/chat");
          }
        }}
      />
      {!collapsed && <ChatThreadsSection open={isChatRoute} />}

      <AppSidebarNavItem
        to="/factory"
        label={t("navigation.triage")}
        icon={IconGitPullRequest}
        active={
          location.pathname === "/factory" ||
          location.pathname === "/new-factory"
        }
      />

      <AppSidebarNavItem
        to="/agents"
        label={t("navigation.agents")}
        icon={IconHierarchy2}
        active={location.pathname.startsWith("/agents")}
      />
    </AppSidebar>
  );
}
