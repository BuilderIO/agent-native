import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  OwnershipChatHistoryRail,
  useOwnershipChatHistory,
  ownDraftRows,
} from "@agent-native/toolkit/app/chat/ownership-history";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import {
  AppSidebar,
  AppSidebarNavItem,
} from "@agent-native/toolkit/app/shared";
import {
  IconGitPullRequest,
  IconHierarchy2,
  IconMessageCircle,
  IconSearch,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
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
    isNewThread,
  } = useChatThreads(undefined, CHAT_STORAGE_KEY, undefined, {
    ownership: "mine",
    autoCreate: false,
    restoreActiveThread: false,
  });

  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    (location.pathname === "/chat" ? null : activeThreadId);
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
    const archived = await history.listProps.onDelete!(threadId);
    if (!archived) return false;
    if (wasActive) {
      await handleNewChat();
    }
    return true;
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
          onSelect={(threadId) => openThread(threadId)}
          onNewChat={() => void handleNewChat()}
          railLabels={{
            newChat: t("chat.newChat"),
            showMore: t("chat.chats"),
            showLess: t("chat.chats"),
          }}
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
  const isChatRoute =
    location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = <OrgSwitcher compact={collapsed} reserveSpace />;

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
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={APP_TITLE}
      appId="factory"
      brandHref="/chat"
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={searchButton}
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
