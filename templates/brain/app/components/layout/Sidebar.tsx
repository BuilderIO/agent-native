import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
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
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { navItems } from "@/lib/brain";

const primaryNavItems = navItems.filter(
  (item) => item.view !== "agent" && item.view !== "settings",
);
const bottomNavItems = navItems.filter(
  (item) => item.view === "agent" || item.view === "settings",
);

const BRAIN_CHAT_STORAGE_KEY = "brain";
const BRAIN_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${BRAIN_CHAT_STORAGE_KEY}`;

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
    return localStorage.getItem(BRAIN_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function BrainChatsSection({ open }: { open: boolean }) {
  const navigate = useNavigate();
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
  } = useChatThreads(undefined, BRAIN_CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads),
    [threads],
  );
  const chatItems = useMemo<ChatHistoryItem[]>(
    () =>
      visibleThreads.map((thread) => ({
        id: thread.id,
        title: threadTitle(thread),
        titleText: threadTitle(thread),
        timestamp:
          thread.id === activeThreadId
            ? undefined
            : formatThreadAge(threadUpdatedAt(thread)),
        pinned: Boolean(thread.pinnedAt),
      })),
    [activeThreadId, visibleThreads],
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
    navigateWithAgentChatViewTransition(navigate, "/home");
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
          activeId={activeThreadId}
          onSelect={openThread}
          onNewChat={() => void handleNewChat()}
          railLabels={{
            newChat: t("chat.newChat"),
            showMore: t("chat.chats"),
            showLess: t("chat.chats"),
          }}
          previewCount={5}
          expandedCount={15}
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
  const isAskRoute = location.pathname === "/home";

  const secondaryItems: AppSidebarItemDefinition[] = bottomNavItems.map(
    (item) => ({
      to: item.href,
      label:
        item.view === "agent"
          ? t("settings.agentTitle")
          : t(`navigation.${item.view}`),
      icon: item.icon,
      active: location.pathname.startsWith(item.href),
    }),
  );

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={t("navigation.brand")}
      brandHref="/home"
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={<DevDatabaseLink />}
    >
      {primaryNavItems.map((item) => {
        const label =
          item.view === "agent"
            ? t("settings.agentTitle")
            : t(`navigation.${item.view}`);
        const isActive =
          item.href === "/home"
            ? isAskRoute
            : location.pathname.startsWith(item.href);
        return (
          <div key={item.href}>
            <AppSidebarNavItem
              to={item.href}
              label={label}
              icon={item.icon}
              active={isActive}
              onClick={(event) => {
                if (
                  item.view === "ask" &&
                  !isAskRoute &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  navigateWithAgentChatViewTransition(navigate, "/home");
                }
              }}
            />
            {!collapsed && item.view === "ask" ? (
              <BrainChatsSection open={isAskRoute} />
            ) : null}
          </div>
        );
      })}
    </AppSidebar>
  );
}
