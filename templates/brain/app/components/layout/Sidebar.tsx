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
import { DevDatabaseLink } from "@agent-native/toolkit/app/db-admin";
import { FeedbackButton } from "@agent-native/toolkit/app/feedback";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import {
  AppSidebar,
  AppSidebarNavItem,
} from "@agent-native/toolkit/app/shared";
import { IconSearch } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  brainAskThreadIdFromPath,
  brainAskThreadPath,
  isBrainAskPath,
  navItems,
} from "@/lib/brain";

const BRAIN_CHAT_STORAGE_KEY = "brain";
const BRAIN_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${BRAIN_CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
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
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    isNewThread,
  } = useChatThreads(undefined, BRAIN_CHAT_STORAGE_KEY, undefined, {
    ownership: "mine",
    autoCreate: false,
    restoreActiveThread: false,
  });
  // The URL is the source of truth for the highlighted thread: this instance is
  // not route-controlled, so its own active id is not cleared by New chat.
  const location = useLocation();
  const activeThreadId = brainAskThreadIdFromPath(location.pathname);

  const history = useOwnershipChatHistory({
    activeId: activeThreadId,
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

  function openThread(threadId: string) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(navigate, brainAskThreadPath(threadId));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: false },
        }),
      );
    });
  }

  // No thread is created here: the id joins the URL on the first saved message.
  function handleNewChat() {
    navigateWithAgentChatViewTransition(navigate, brainAskThreadPath(null));
  }

  async function handleArchiveThread(threadId: string) {
    const wasActive =
      threadId === activeThreadId || threadId === persistedActiveThreadId();
    const archived = await history.listProps.onDelete!(threadId);
    if (!archived) return false;
    if (wasActive) {
      handleNewChat();
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
          activeId={activeThreadId}
          onSelect={openThread}
          onNewChat={handleNewChat}
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
  const isAskRoute = isBrainAskPath(location.pathname);

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
          aria-label={t("navigation.search")}
        >
          <IconSearch className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("navigation.search")}</TooltipContent>
    </Tooltip>
  );

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={t("navigation.brand")}
      appId="brain"
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
        const label = t(`navigation.${item.view}`);
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
