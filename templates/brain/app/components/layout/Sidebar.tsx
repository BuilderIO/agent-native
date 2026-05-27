import { useEffect, useMemo } from "react";
import { NavLink, useNavigate } from "react-router";
import { IconBrain, IconPlus, IconSettings } from "@tabler/icons-react";
import {
  FeedbackButton,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { navItems } from "@/lib/brain";
import { cn } from "@/lib/utils";
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
  return thread.title || thread.preview || "New chat";
}

function BrainChatsSection() {
  const navigate = useNavigate();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    refreshThreads,
  } = useChatThreads(undefined, undefined, undefined, { autoCreate: false });

  const visibleThreads = useMemo(
    () =>
      threads
        .filter(
          (thread) => thread.messageCount > 0 || thread.id === activeThreadId,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [activeThreadId, threads],
  );

  useEffect(() => {
    const refresh = () => refreshThreads();
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { isRunning?: unknown }
        | undefined;
      if (detail?.isRunning === false) refreshThreads();
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
        {visibleThreads.length > 0 ? (
          visibleThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => openThread(thread.id)}
                className={cn(
                  "flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {threadTitle(thread)}
                </span>
                <span className="shrink-0 text-[11px] text-sidebar-foreground/50">
                  {isActive ? "" : formatThreadAge(thread.updatedAt)}
                </span>
              </button>
            );
          })
        ) : (
          <button
            type="button"
            onClick={handleNewChat}
            className="flex h-8 items-center rounded-md px-2 text-left text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
          >
            <span className="truncate">New chat</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
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
        <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <IconBrain className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
            Brain
          </p>
          <p className="truncate text-xs text-sidebar-foreground/70">
            Company memory
          </p>
        </div>
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
                {item.view === "ask" ? <BrainChatsSection /> : null}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="grid gap-2 border-t border-sidebar-border px-3 py-3">
        <NavLink to="/settings" className={navClass}>
          <IconSettings className="size-4 shrink-0" />
          <span className="truncate">Settings</span>
        </NavLink>
        <FeedbackButton />
        <OrgSwitcher />
      </div>
    </aside>
  );
}
