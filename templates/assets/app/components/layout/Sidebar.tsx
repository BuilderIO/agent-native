import {
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useActionQuery } from "@agent-native/core/client/hooks";
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
  IconClipboardList,
  IconLayoutGrid,
  IconPhotoPlus,
  IconSettings,
  IconShare3,
  IconTemplate,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

const baseNavItems = [
  { icon: IconPhotoPlus, labelKey: "navigation.create", href: "/home" },
  { icon: IconLayoutGrid, labelKey: "navigation.library", href: "/library" },
  { icon: IconTemplate, labelKey: "navigation.templates", href: "/templates" },
];

const bottomNavItems = [
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
];

const auditNavItem = {
  icon: IconClipboardList,
  labelKey: "navigation.auditLog",
  href: "/audit",
};

const COLLAPSE_KEY = "assets.sidebar.collapsed";
const ASSETS_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${ASSETS_CHAT_STORAGE_KEY}`;

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
    return localStorage.getItem(ASSETS_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string) {
  try {
    localStorage.setItem(ASSETS_ACTIVE_THREAD_KEY, threadId);
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

function AssetsChatsSection({ open }: { open: boolean }) {
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
    createThreadShareLink,
    refreshThreads,
  } = useChatThreads(undefined, ASSETS_CHAT_STORAGE_KEY, undefined, {
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
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    (location.pathname === "/home" ? null : activeThreadId);
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
      options?.isNew ? "/home" : chatThreadPath(threadId),
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

  async function handleCopyShareLink(threadId: string) {
    const link = await createThreadShareLink(threadId);
    if (!link?.url) {
      toast.error(t("chat.shareLinkFailed"));
      return;
    }

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(link.url);
      toast.success(t("chat.shareLinkCopied"));
    } catch {
      toast.success(t("chat.shareLinkReady"), {
        description: link.url,
      });
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
          renderAdditionalRowActions={(item, closeMenu) => (
            <button
              type="button"
              role="menuitem"
              className="an-chat-history-row__menu-item"
              onClick={() => {
                closeMenu();
                void handleCopyShareLink(item.id);
              }}
            >
              <IconShare3 size={13} strokeWidth={1.8} />
              <span>{t("chat.copyShareLink")}</span>
            </button>
          )}
          labels={{
            options: (item) =>
              t("chat.optionsFor", { title: item.titleText ?? "" }),
            renameInput: (item) => `Rename ${item.titleText ?? ""}`,
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

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isCreateRoute =
    location.pathname === "/home" || location.pathname.startsWith("/chat/");
  const { data: auditAdmin } = useActionQuery("is-audit-admin", {}, {
    refetchInterval: 30_000,
  } as any) as { data: { allowed?: boolean } | undefined };
  const navItems = auditAdmin?.allowed
    ? [...baseNavItems, auditNavItem]
    : baseNavItems;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // localStorage unavailable / quota — ignore
    }
  }, [collapsed]);

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: location.pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  return (
    <AppSidebar
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      brandName={t("navigation.brand")}
      brandHref="/home"
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={<DevDatabaseLink />}
    >
      {navItems.map((item) => {
        const isActive =
          item.href === "/home"
            ? isCreateRoute
            : item.href === "/library"
              ? location.pathname === "/library" ||
                location.pathname.startsWith("/library/") ||
                location.pathname.startsWith("/brand-kits/") ||
                location.pathname.startsWith("/image/") ||
                location.pathname.startsWith("/asset/")
              : item.href === "/templates"
                ? location.pathname === "/templates" ||
                  location.pathname.startsWith("/templates/")
                : location.pathname.startsWith(item.href);

        return (
          <div key={item.href}>
            <AppSidebarNavItem
              to={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={isActive}
              onClick={(event) => {
                if (
                  item.href === "/home" &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  focusAgentChat();
                  if (!isCreateRoute || location.pathname !== "/home") {
                    navigateWithAgentChatViewTransition(navigate, "/home");
                  }
                }
              }}
            />
            {!collapsed && item.href === "/home" ? (
              <AssetsChatsSection open={isCreateRoute} />
            ) : null}
          </div>
        );
      })}
    </AppSidebar>
  );
}
