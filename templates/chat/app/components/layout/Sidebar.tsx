import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  navigateWithAgentChatViewTransition,
  useAgentChatRunningThreads,
  useChatThreads,
} from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import {
  ownDraftRows,
  OwnershipChatHistoryRail,
  useOwnershipChatHistory,
} from "@agent-native/toolkit/app/chat/ownership-history";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared/AgentNativeIcon";
import {
  IconEdit,
  IconHome,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLoader2,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { chatThreadPath, HOME_PATH, threadIdFromPath } from "@/lib/chat-paths";
import { cn } from "@/lib/utils";

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function ThreadHistoryTitle({
  title,
  running,
}: {
  title: string;
  running: boolean;
}) {
  const t = useT();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

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
    <span className="chat-sidebar-thread-title-shell">
      <span
        ref={viewportRef}
        className="chat-sidebar-thread-title"
        data-overflow={isOverflowing ? "true" : "false"}
      >
        <span ref={contentRef} className="chat-sidebar-thread-title__content">
          {title}
        </span>
      </span>
      {running ? (
        <IconLoader2
          className="chat-sidebar-thread-running size-4 shrink-0 motion-safe:animate-spin"
          strokeWidth={1.8}
          role="status"
          aria-label={t(
            // i18n-key-ignore shared framework catalog
            "agentChat.status.working",
          )}
        />
      ) : null}
    </span>
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

function HomeNavLink({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const location = useLocation();
  const active = location.pathname === HOME_PATH;
  const link = (
    <Link
      to={HOME_PATH}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? t("navigation.home") : undefined}
      className={cn(
        "flex items-center text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active && "bg-sidebar-accent",
        collapsed
          ? "size-8 justify-center rounded-md"
          : "h-8 w-full gap-3 rounded-lg px-3 text-sm font-medium",
      )}
    >
      <IconHome className="size-4 shrink-0" strokeWidth={1.8} />
      <span className={collapsed ? "sr-only" : "truncate"}>
        {t("navigation.home")}
      </span>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{t("navigation.home")}</TooltipContent>
      </Tooltip>
    );
  }

  return <div className="px-2">{link}</div>;
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
    isNewThread,
  } = useChatThreads(undefined, CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });
  const { workingThreadIds, observedThreadStarts } =
    useAgentChatRunningThreads();

  const localMineRows = ownDraftRows({
    threads,
    isNewThread,
    observedThreadStarts,
  });
  const history = useOwnershipChatHistory({
    getThreadUrl: (threadId) => appPath(chatThreadPath(threadId)),
    activeId:
      threadIdFromPath(location.pathname) ??
      activeThreadId ??
      persistedActiveThreadId(),
    localMineRows,
    pinned: { label: t("chat.pinned") },
    mutations: {
      pin: pinThread,
      rename: renameThread,
      archive: archiveThread,
    },
    onMutationFailed: (kind) => {
      if (kind === "archive") toast.error(t("chat.archiveFailed"));
      if (kind === "rename") toast.error(t("chat.renameFailed"));
    },
    decorateItem: (item, row) => {
      const title = row.title || row.preview || t("chat.untitledChat");
      return {
        ...item,
        title: (
          <ThreadHistoryTitle
            title={title}
            running={workingThreadIds.has(row.id)}
          />
        ),
      };
    },
  });
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    activeThreadId ??
    persistedActiveThreadId();

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

  const newChatButton = (
    <button
      type="button"
      onClick={() => void handleNewChat()}
      className={cn(
        "flex items-center text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        collapsed
          ? "size-8 justify-center rounded-md"
          : "h-8 w-full gap-3 rounded-lg px-3 text-sm font-medium",
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
      <OwnershipChatHistoryRail
        {...history}
        onNewChat={() => void handleNewChat()}
        showNewChat={false}
        activeId={displayedActiveThreadId}
        onSelect={openThread}
        onDelete={async (threadId) => {
          const wasActive =
            threadId === activeThreadId ||
            threadId === persistedActiveThreadId();
          const archived = await history.listProps.onDelete?.(threadId);
          if (archived && wasActive) await handleNewChat();
        }}
        renameMaxLength={160}
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
        railLabels={{
          newChat: t("chat.newChat"),
        }}
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/"
                aria-label={APP_TITLE}
                className="flex size-8 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <AgentNativeIcon
                  aria-hidden="true"
                  className="h-3.5 w-6 text-sidebar-accent-foreground"
                />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{APP_TITLE}</TooltipContent>
          </Tooltip>
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
        <HomeNavLink collapsed={collapsed} />
        <ChatThreadsSection collapsed={collapsed} />
      </nav>

      <div className="mt-auto shrink-0 border-t border-sidebar-border p-2">
        <div
          className={cn(
            collapsed
              ? "flex flex-col items-center gap-1"
              : "flex items-center gap-0.5",
          )}
        >
          <OrgSwitcher
            reserveSpace
            compact={collapsed}
            currentAppId="chat"
            className={
              collapsed
                ? "size-8 bg-transparent p-0 hover:bg-sidebar-accent"
                : "min-w-0 flex-1 h-11 rounded-lg bg-transparent px-3 py-2 text-sm text-sidebar-accent-foreground hover:bg-sidebar-accent"
            }
          />
          {searchButton}
          {collapseButton}
        </div>
      </div>
    </aside>
  );
}
