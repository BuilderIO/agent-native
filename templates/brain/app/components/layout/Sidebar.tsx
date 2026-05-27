import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  IconArchive,
  IconDots,
  IconEdit,
  IconPin,
  IconPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  appPath,
  FeedbackButton,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { navItems } from "@/lib/brain";
import { cn } from "@/lib/utils";
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
    return localStorage.getItem("agent-chat-active-thread");
  } catch {
    return null;
  }
}

function BrainChatsSection() {
  const navigate = useNavigate();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, undefined, undefined, {
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
        .slice(0, 8),
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
    navigate("/");
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
    await archiveThread(threadId);
    if (wasActive) {
      await handleNewChat();
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
      if (!renamed) toast.error("Could not rename chat.");
    }
    committingRenameRef.current = false;
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void commitRenameThread();
  }

  return (
    <div className="mt-2 border-l border-sidebar-border/70 pl-3">
      <div className="mb-1 flex h-7 items-center gap-2 pr-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          Chats
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="New Brain chat"
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-0.5">
        {visibleThreads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          const isRenaming = thread.id === renamingThreadId;
          return (
            <div
              key={thread.id}
              className={cn(
                "group flex h-8 min-w-0 items-center rounded-md text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
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
                    className="h-6 min-w-0 rounded-sm border-sidebar-border bg-background px-1.5 text-xs"
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openThread(thread.id)}
                    className="flex h-full min-w-0 flex-1 items-center px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {threadTitle(thread)}
                    </span>
                  </button>
                  <div className="relative flex size-7 shrink-0 items-center justify-end pr-1">
                    <span className="text-[11px] text-sidebar-foreground/50 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {isActive ? "" : formatThreadAge(threadUpdatedAt(thread))}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Chat options for ${threadTitle(thread)}`}
                          className="absolute right-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/65 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
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
                          <IconEdit className="size-4" />
                          Rename chat
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void pinThread(thread.id, !thread.pinnedAt)
                          }
                        >
                          <IconPin className="size-4" />
                          {thread.pinnedAt ? "Unpin chat" : "Pin chat"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => void handleArchiveThread(thread.id)}
                        >
                          <IconArchive className="size-4" />
                          Archive chat
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
  const isAskRoute = location.pathname === "/";
  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
    );

  return (
    <aside className="flex h-full w-60 min-w-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
              Brain
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="grid gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.href}>
                <NavLink
                  to={item.href}
                  end={item.href === "/"}
                  className={navClass}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
                {item.view === "ask" && isAskRoute ? (
                  <BrainChatsSection />
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="mt-auto shrink-0">
        <div className="border-t border-sidebar-border px-2 py-1">
          <ExtensionsSidebarSection />
        </div>

        <div className="border-t border-sidebar-border px-3 py-2">
          <OrgSwitcher />
        </div>

        <div className="border-t border-sidebar-border px-3 py-2">
          <FeedbackButton />
        </div>
      </div>
    </aside>
  );
}
