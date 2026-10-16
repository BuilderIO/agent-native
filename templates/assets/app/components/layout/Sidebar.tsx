import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
} from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import {
  OwnershipChatHistoryRail,
  useOwnershipChatHistory,
  ownDraftRows,
} from "@agent-native/toolkit/app/chat/ownership-history";
import { DevDatabaseLink } from "@agent-native/toolkit/app/db-admin";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import {
  AppSidebar,
  AppSidebarNavItem,
} from "@agent-native/toolkit/app/shared";
import {
  IconClipboardList,
  IconLayoutGrid,
  IconPhotoPlus,
  IconSearch,
  IconShare3,
  IconTemplate,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";

const baseNavItems = [
  { icon: IconPhotoPlus, labelKey: "navigation.create", href: "/home" },
  { icon: IconLayoutGrid, labelKey: "navigation.library", href: "/library" },
  { icon: IconTemplate, labelKey: "navigation.templates", href: "/templates" },
];

const auditNavItem = {
  icon: IconClipboardList,
  labelKey: "navigation.auditLog",
  href: "/audit",
};

const COLLAPSE_KEY = "assets.sidebar.collapsed";
const ASSETS_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${ASSETS_CHAT_STORAGE_KEY}`;

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
    isNewThread,
  } = useChatThreads(undefined, ASSETS_CHAT_STORAGE_KEY, undefined, {
    ownership: "mine",
    autoCreate: false,
    restoreActiveThread: false,
  });

  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    (location.pathname === "/home" ? null : activeThreadId);
  const history = useOwnershipChatHistory({
    activeId: displayedActiveThreadId,
    localMineRows: ownDraftRows({ threads, isNewThread }),
    mutations: {
      pin: pinThread,
      rename: renameThread,
      archive: archiveThread,
    },
    onMutationFailed: (kind) => {
      toast.error(
        t(
          kind === "archive"
            ? "chat.archiveFailed"
            : kind === "rename"
              ? "chat.renameFailed"
              : "agentChat.common.saveFailed",
        ),
      );
    },
  });

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
    const archived = await history.listProps.onDelete!(threadId);
    if (!archived) return false;
    if (wasActive) {
      await handleNewChat();
    }
    return true;
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

  return (
    <div
      className="an-chat-history-rail__collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
    >
      <div className="ms-4">
        <OwnershipChatHistoryRail
          {...history}
          activeId={displayedActiveThreadId}
          onSelect={openThread}
          onNewChat={() => void handleNewChat()}
          railLabels={{
            newChat: t("chat.newChat"),
            showMore: t("chat.chats"),
            showLess: t("chat.chats"),
          }}
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

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} />;

  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-primary hover:bg-accent/60 hover:text-primary"
          onClick={openCommandMenu}
          aria-label={t("root.commandSearch")}
        >
          <IconSearch className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("root.commandSearch")}</TooltipContent>
    </Tooltip>
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      brandName={t("navigation.brand")}
      appId="assets"
      brandHref="/home"
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={
        <>
          {searchButton}
          <DevDatabaseLink />
        </>
      }
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
