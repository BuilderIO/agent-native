import {
  agentNativePath,
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  PromptComposer,
  sendToAgentChat,
  useCodeMode,
  useChatThreads,
  useSendToAgentChat,
  useSession,
  useT,
  type ChatThreadSummary,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconArchive,
  IconBrain,
  IconClipboardCheck,
  IconDots,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessageCircle,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlans } from "@/hooks/use-plans";
import { APP_TITLE } from "@/lib/app-config";
import { planReturnPathFromLocation } from "@/lib/plan-local-bridge";
import { cn } from "@/lib/utils";

const PLAN_CHAT_STORAGE_KEY = "plans";

const PLAN_BRANDING_CODE_CONTEXT = [
  "The user is using the Plan app branding customization popover.",
  "Make source-code changes for Agent-Native Plan branding in templates/plan.",
  "Inspect the current brand surfaces first: app/lib/app-config.ts, app/components/layout/Sidebar.tsx, app/root.tsx metadata/icons, public brand assets, and app/global.css theme tokens.",
  "Keep runtime plan data, stored plans, recaps, comments, and generated plan content unchanged unless the user explicitly asks for those data changes.",
  "Use existing Plan styling, shadcn primitives, Tabler icons, and repo patterns. Keep changes tightly scoped.",
].join("\n");

function buildBrandingCustomizationMessage(request: string) {
  return [
    "Customize the Agent-Native Plan app branding.",
    "",
    "Request:",
    request,
  ].join("\n");
}

const navItems = [
  { icon: IconMessageCircle, labelKey: "navigation.ask", href: "/" },
  { icon: IconClipboardCheck, labelKey: "navigation.plan", href: "/plans" },
  { icon: IconBrain, labelKey: "settings.agentTitle", href: "/agent" },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
];

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function formatPlanAge(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
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
    return localStorage.getItem(
      `agent-chat-active-thread:${PLAN_CHAT_STORAGE_KEY}`,
    );
  } catch {
    return null;
  }
}

function PlanChatsSection({ collapsed }: { collapsed: boolean }) {
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
  } = useChatThreads(undefined, PLAN_CHAT_STORAGE_KEY, undefined, {
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

  if (collapsed) return null;

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(navigate, "/");
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
      toast.error(t("raw.sidebar.archiveChatFailed"));
      return;
    }
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
      if (!renamed) toast.error(t("raw.sidebar.renameChatFailed"));
    }
    committingRenameRef.current = false;
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void commitRenameThread();
  }

  return (
    <div className="mt-2 border-s border-sidebar-border/70 ps-3">
      <div className="mb-1 flex h-7 items-center gap-2 pe-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          {t("sidebar.chats")}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label={t("sidebar.newPlanChat")}
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.newChat")}</TooltipContent>
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
                    className="flex h-full min-w-0 flex-1 items-center px-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {threadTitle(thread)}
                    </span>
                  </button>
                  <div className="relative flex size-7 shrink-0 items-center justify-end pe-1">
                    <span className="text-[11px] text-sidebar-foreground/50 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                      {isActive ? "" : formatThreadAge(threadUpdatedAt(thread))}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Chat options for ${threadTitle(thread)}`}
                          className="absolute end-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/65 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
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
                          {t("sidebar.renameChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void pinThread(thread.id, !thread.pinnedAt)
                          }
                        >
                          <IconPin className="size-4" />
                          {thread.pinnedAt
                            ? t("sidebar.unpinChat")
                            : t("sidebar.pinChat")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => void handleArchiveThread(thread.id)}
                        >
                          <IconArchive className="size-4" />
                          {t("sidebar.archiveChat")}
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

function signInForPlanCreate() {
  window.location.href = `${agentNativePath(
    "/_agent-native/sign-in",
  )}?return=${encodeURIComponent("/plans?create=1")}`;
}

function signInWithReturnPath(returnPath: string) {
  window.location.href = `${agentNativePath(
    "/_agent-native/sign-in",
  )}?return=${encodeURIComponent(returnPath || "/")}`;
}

function PlansSidebarSection({ collapsed }: { collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const { session, isLoading: sessionLoading } = useSession();
  const plansQuery = usePlans({
    enabled: Boolean(session),
  });
  const selectedPlanId = (location.pathname.match(/^\/plans\/([^/]+)/) ??
    location.pathname.match(/^\/recaps\/([^/]+)/))?.[1];
  const allPlans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);
  const plans = useMemo(
    () => allPlans.filter((p) => p.status !== "archived").slice(0, 10),
    [allPlans],
  );
  const hasMore = useMemo(
    () => allPlans.filter((p) => p.status !== "archived").length > 10,
    [allPlans],
  );

  if (collapsed) return null;

  const requestCreatePlan = () => {
    if (sessionLoading) return;
    if (!session) {
      signInForPlanCreate();
      return;
    }
    markAgentChatHomeHandoff("plans");
    navigateWithAgentChatViewTransition(navigate, "/plans?create=1");
  };

  const openPlanPath = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    markAgentChatHomeHandoff("plans");
    navigateWithAgentChatViewTransition(navigate, path);
  };

  return (
    <div className="mt-2 border-s border-sidebar-border/70 ps-3">
      <div className="mb-1 flex h-7 items-center gap-2 pe-1">
        <div className="min-w-0 flex-1 text-xs font-medium text-sidebar-foreground/70">
          {t("sidebar.planSection")}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={requestCreatePlan}
              disabled={sessionLoading}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label={
                session ? t("sidebar.newPlan") : t("sidebar.signInCreatePlan")
              }
            >
              <IconPlus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {session ? t("sidebar.newPlan") : t("sidebar.signInToCreate")}
          </TooltipContent>
        </Tooltip>
      </div>

      {sessionLoading ? (
        <div className="grid gap-1">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-8 rounded-md bg-sidebar-accent" />
          ))}
        </div>
      ) : !session ? (
        <button
          type="button"
          onClick={signInForPlanCreate}
          className="rounded-md px-2 py-1.5 text-start text-xs leading-5 text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
        >
          {t("sidebar.signInKeepPlans")}
        </button>
      ) : plansQuery.isLoading ? (
        <div className="grid gap-1">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-8 rounded-md bg-sidebar-accent" />
          ))}
        </div>
      ) : plansQuery.isError ? (
        <div className="grid gap-2 rounded-md border border-sidebar-border/70 p-2">
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            {t("plansPage.loadError.didNotLoadTitle")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 justify-center text-xs"
            onClick={() => void plansQuery.refetch()}
          >
            <IconRefresh className="size-3.5" />
            {t("plansPage.loadError.retry")}
          </Button>
        </div>
      ) : plans.length === 0 ? (
        <p className="px-2 py-1.5 text-xs leading-5 text-sidebar-foreground/55">
          {t("sidebar.noPlans")}
        </p>
      ) : (
        <div className="grid gap-0.5">
          {plans.map((plan) => {
            const isActive = plan.id === selectedPlanId;
            const href =
              plan.kind === "recap"
                ? `/recaps/${plan.id}`
                : `/plans/${plan.id}`;
            return (
              <Link
                key={plan.id}
                to={href}
                onClick={(event) => openPlanPath(event, href)}
                className={cn(
                  "group flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                {plan.kind === "recap" && (
                  <Badge
                    variant="outline"
                    className="h-4 shrink-0 rounded px-1 text-[9px]"
                  >
                    {t("sidebar.recapBadge")}
                  </Badge>
                )}
                {plan.openCommentCount > 0 ? (
                  <Badge
                    variant="secondary"
                    className="h-5 shrink-0 rounded-full px-1.5 text-[10px]"
                  >
                    {plan.openCommentCount}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-[11px] text-sidebar-foreground/45">
                    {formatPlanAge(plan.updatedAt)}
                  </span>
                )}
              </Link>
            );
          })}
          {hasMore && (
            <Link
              to="/plans"
              onClick={(event) => openPlanPath(event, "/plans")}
              className="rounded-md px-2 py-1.5 text-start text-xs leading-5 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
            >
              {t("sidebar.viewAllPlans")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function BrandingCustomizePopover() {
  const [open, setOpen] = useState(false);
  const { isCodeMode } = useCodeMode();
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();
  const t = useT();

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    const message = buildBrandingCustomizationMessage(trimmed);
    const payload = {
      message,
      context: PLAN_BRANDING_CODE_CONTEXT,
      submit: true,
      type: "code" as const,
      newTab: true,
    };
    const tabId = isCodeMode ? sendToAgentChat(payload) : send(payload);
    setOpen(false);
    if (tabId) {
      toast.success(
        isCodeMode ? t("sidebar.brandingSentLocal") : t("sidebar.brandingSent"),
      );
    }
  }

  return (
    <>
      {codeRequiredDialog}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("sidebar.customizePlanBranding")}
            title={t("sidebar.customizeBranding")}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/55 opacity-0 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/brand:opacity-100 group-focus-within/brand:opacity-100 data-[state=open]:opacity-100"
          >
            <IconEdit className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[calc(100vw-2rem)] max-w-[420px] rounded-xl border-border bg-card p-3 shadow-xl sm:w-[420px]"
        >
          <div className="mb-2 px-1">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sidebar.customizeBranding")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("sidebar.customizeBrandingDescription")}
            </p>
          </div>
          <PromptComposer
            autoFocus
            disabled={isGenerating}
            attachmentsEnabled={false}
            showModelSelector={false}
            placeholder={t("sidebar.customizeBrandingPlaceholder")}
            draftScope="plans:customize-branding"
            onSubmit={handleSubmit}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

export function Sidebar({
  collapsed = false,
  collapsible = true,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const { session, isLoading: sessionLoading } = useSession();
  const t = useT();
  const returnPath = planReturnPathFromLocation(location);
  const ToggleIcon = collapsed
    ? IconLayoutSidebarLeftExpand
    : IconLayoutSidebarLeftCollapse;
  const collapseButton = collapsible ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-label={
            collapsed
              ? t("sidebar.expandSidebar")
              : t("sidebar.collapseSidebar")
          }
        >
          <ToggleIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "group/brand flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "gap-2 px-3",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            collapsed ? "justify-center" : "flex-1",
          )}
        >
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto max-w-7 shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto max-w-7 shrink-0 dark:block"
          />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              {APP_TITLE}
            </span>
          )}
        </div>
        {!collapsed && <BrandingCustomizePopover />}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? location.pathname === "/"
              : item.href === "/plans"
                ? location.pathname.startsWith("/plans") ||
                  location.pathname.startsWith("/recaps") ||
                  location.pathname.startsWith("/local-plans")
                : location.pathname.startsWith(item.href);
          const link = (
            <Link
              to={item.href}
              onClick={() => {
                if (item.href !== "/") markAgentChatHomeHandoff("plans");
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                collapsed && "justify-center gap-0 px-0",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {collapsed ? (
                <span className="sr-only">{t(item.labelKey)}</span>
              ) : (
                t(item.labelKey)
              )}
            </Link>
          );
          return (
            <div key={item.href}>
              {link}
              {item.href === "/" && isActive ? (
                <PlanChatsSection collapsed={collapsed} />
              ) : null}
              {item.href === "/plans" && isActive ? (
                <PlansSidebarSection collapsed={collapsed} />
              ) : null}
            </div>
          );
        })}
      </nav>

      {!collapsed && session && (
        <>
          <div className="px-2 py-2">
            <ExtensionsSidebarSection />
          </div>

          <div className="space-y-2 px-3 py-2">
            <DevDatabaseLink />
            <FeedbackButton />
            <OrgSwitcher />
          </div>
        </>
      )}

      {!collapsed && !sessionLoading && !session && (
        <div className="space-y-2 px-3 py-2">
          <DevDatabaseLink />
          <FeedbackButton />
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => signInWithReturnPath(returnPath)}
            >
              {t("sidebar.signIn")}
            </Button>
            {collapseButton}
          </div>
        </div>
      )}

      {collapsed && collapsible ? (
        <div
          className={cn(
            "px-2 py-2",
            collapsed ? "flex justify-center" : "flex justify-end",
          )}
        >
          {collapseButton}
        </div>
      ) : null}

      {!collapsed && (session || sessionLoading) && collapsible ? (
        <div className="flex justify-end px-2 py-2">{collapseButton}</div>
      ) : null}
    </aside>
  );
}
