import {
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useActionQuery,
  useChatThreads,
  useT,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconArchive,
  IconClipboardList,
  IconDots,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutGrid,
  IconPhotoPlus,
  IconPin,
  IconPlus,
  IconSettings,
  IconShare3,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ASSETS_CHAT_STORAGE_KEY } from "@/lib/chat";
import { cn } from "@/lib/utils";

const baseNavItems = [
  { icon: IconPhotoPlus, labelKey: "navigation.create", href: "/" },
  { icon: IconLayoutGrid, labelKey: "navigation.library", href: "/library" },
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

function AssetsChatsSection() {
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
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const committingRenameRef = useRef(false);

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 10),
    [threads],
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

  useEffect(() => {
    if (!renamingThreadId) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renamingThreadId]);

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
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

  function startRenameThread(thread: ChatThreadSummary) {
    committingRenameRef.current = false;
    setRenameDraft(threadTitle(thread));
    setRenamingThreadId(thread.id);
  }

  function cancelRenameThread() {
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
  }

  async function commitRenameThread() {
    if (committingRenameRef.current) return;
    const threadId = renamingThreadId;
    const title = renameDraft.trim();
    if (!threadId) return;
    committingRenameRef.current = true;
    setRenamingThreadId(null);
    setRenameDraft("");
    if (title) {
      const renamed = await renameThread(threadId, title);
      if (!renamed) toast.error(t("chat.renameFailed"));
    }
    committingRenameRef.current = false;
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void commitRenameThread();
  }

  return (
    <div className="mt-2 border-s border-border/70 ps-3">
      <div className="mb-1 flex h-7 items-center gap-2 pe-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          {t("chat.chats")}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={t("chat.newAssetsChat")}
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("chat.newChat")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-0.5">
        {visibleThreads.map((thread) => {
          const isActive =
            thread.id ===
            (threadIdFromPath(location.pathname) ??
              (location.pathname === "/" ? null : activeThreadId));
          const isRenaming = thread.id === renamingThreadId;
          return (
            <div
              key={thread.id}
              className={cn(
                "group flex h-8 min-w-0 items-center rounded-md text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
              )}
            >
              {isRenaming ? (
                <form
                  onSubmit={handleRenameSubmit}
                  className="flex h-full min-w-0 flex-1 items-center px-1.5"
                >
                  <Input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => void commitRenameThread()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenameThread();
                      }
                    }}
                    maxLength={160}
                    aria-label={`Rename ${threadTitle(thread)}`}
                    className="h-6 min-w-0 rounded-sm border-border bg-background px-1.5 text-xs"
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openThread(thread.id)}
                    className="flex h-full min-w-0 flex-1 items-center px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {threadTitle(thread)}
                    </span>
                  </button>
                  <div className="relative flex w-auto min-w-7 shrink-0 items-center justify-end pe-1">
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/75 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {isActive ? "" : formatThreadAge(threadUpdatedAt(thread))}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("chat.optionsFor", {
                            title: threadTitle(thread),
                          })}
                          className="absolute end-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                        >
                          <IconDots className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        side="right"
                        sideOffset={6}
                      >
                        <DropdownMenuItem
                          onSelect={() => startRenameThread(thread)}
                        >
                          <IconEdit className="me-2 size-4" />
                          {t("chat.renameChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void pinThread(thread.id, !thread.pinnedAt)
                          }
                        >
                          <IconPin className="me-2 size-4" />
                          {thread.pinnedAt
                            ? t("chat.unpinChat")
                            : t("chat.pinChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void handleCopyShareLink(thread.id)}
                        >
                          <IconShare3 className="me-2 size-4" />
                          {t("chat.copyShareLink")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => void handleArchiveThread(thread.id)}
                        >
                          <IconArchive className="me-2 size-4" />
                          {t("chat.archiveChat")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const isCreateRoute =
    location.pathname === "/" || location.pathname.startsWith("/chat/");
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

  return (
    <aside
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2">
            <img
              src={appPath("/agent-native-icon-light.svg")}
              alt=""
              aria-hidden="true"
              className="block h-4 w-auto dark:hidden"
            />
            <img
              src={appPath("/agent-native-icon-dark.svg")}
              alt=""
              aria-hidden="true"
              className="hidden h-4 w-auto dark:block"
            />
            <span className="text-sm font-semibold tracking-tight">
              {t("navigation.brand")}
            </span>
          </div>
        )}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              aria-label={
                collapsed
                  ? t("navigation.expandSidebar")
                  : t("navigation.collapseSidebar")
              }
            >
              {collapsed ? (
                <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
              ) : (
                <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed
              ? t("navigation.expandSidebar")
              : t("navigation.collapseSidebar")}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav
          className={cn(
            "space-y-1 py-2",
            collapsed ? "flex flex-col items-center px-1.5" : "px-2",
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? isCreateRoute
                : item.href === "/library"
                  ? location.pathname === "/library" ||
                    location.pathname.startsWith("/library/") ||
                    location.pathname.startsWith("/brand-kits/") ||
                    location.pathname.startsWith("/image/") ||
                    location.pathname.startsWith("/asset/")
                  : location.pathname.startsWith(item.href);
            const link = (
              <Link
                key={item.href}
                to={item.href}
                onClick={(event) => {
                  if (
                    item.href === "/" &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    focusAgentChat();
                    if (!isCreateRoute || location.pathname !== "/") {
                      navigateWithAgentChatViewTransition(navigate, "/");
                    }
                  }
                }}
                className={cn(
                  "flex items-center rounded-lg text-sm",
                  collapsed ? "h-9 w-9 justify-center" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && t(item.labelKey)}
              </Link>
            );
            if (collapsed) {
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {t(item.labelKey)}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return (
              <div key={item.href}>
                {link}
                {item.href === "/" && isCreateRoute ? (
                  <AssetsChatsSection />
                ) : null}
              </div>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="mt-auto shrink-0">
            <div className="px-2 py-1">
              <ExtensionsSidebarSection />
            </div>

            <div className="px-3 py-2">
              <OrgSwitcher />
            </div>

            <div className="px-3 py-2">
              <DevDatabaseLink />
              <FeedbackButton />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
