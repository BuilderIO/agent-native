import {
  navigateWithAgentChatViewTransition,
  sendToAgentChat,
  useChatThreads,
  useSendToAgentChat,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { useCodeMode } from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/core/client/composer";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  AppSidebarNavItem,
  AgentNativeIcon,
  buildSignInReturnHref,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";
import {
  IconClipboardCheck,
  IconEdit,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  "Make source-code changes for Plan branding in templates/plan.",
  "Inspect the current brand surfaces first: app/lib/app-config.ts, app/components/layout/Sidebar.tsx, app/root.tsx metadata/icons, public brand assets, and app/global.css theme tokens.",
  "Keep runtime plan data, stored plans, recaps, comments, and generated plan content unchanged unless the user explicitly asks for those data changes.",
  "Use existing Plan styling, shadcn primitives, Tabler icons, and repo patterns. Keep changes tightly scoped.",
].join("\n");

function buildBrandingCustomizationMessage(request: string) {
  return ["Customize the Plan app branding.", "", "Request:", request].join(
    "\n",
  );
}

const navItems = [
  { icon: IconMessageCircle, labelKey: "navigation.ask", href: "/chat" },
  { icon: IconClipboardCheck, labelKey: "navigation.plan", href: "/plans" },
];

const bottomNavItems = [
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

function PlanChatsSection({
  collapsed,
  open,
}: {
  collapsed: boolean;
  open: boolean;
}) {
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

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 15),
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

  if (collapsed) return null;

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(navigate, "/chat");
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

  function handleRenameThread(threadId: string, title: string) {
    void renameThread(threadId, title).then((renamed) => {
      if (!renamed) toast.error(t("raw.sidebar.renameChatFailed"));
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
          onSelect={(threadId) => openThread(threadId)}
          onNewChat={() => void handleNewChat()}
          railLabels={{
            newChat: t("sidebar.newChat"),
            showMore: t("sidebar.chats"),
            showLess: t("sidebar.chats"),
          }}
          renameMaxLength={160}
          onTogglePin={(threadId) => {
            const thread = visibleThreads.find((item) => item.id === threadId);
            if (thread) void pinThread(threadId, !thread.pinnedAt);
          }}
          onRename={handleRenameThread}
          onDelete={(threadId) => void handleArchiveThread(threadId)}
          labels={{
            options: (item) => `${t("sidebar.chats")}: ${item.titleText ?? ""}`,
            renameInput: (item) =>
              `${t("sidebar.renameChat")}: ${item.titleText ?? ""}`,
            rename: t("sidebar.renameChat"),
            pin: t("sidebar.pinChat"),
            unpin: t("sidebar.unpinChat"),
            delete: t("sidebar.archiveChat"),
          }}
          className="min-w-0"
        />
      </div>
    </div>
  );
}

function signInForPlanCreate() {
  window.location.href = buildSignInReturnHref({
    returnTo: "/plans?create=1",
  });
}

function signInWithReturnPath(returnPath: string) {
  window.location.href = buildSignInReturnHref({ returnTo: returnPath });
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
    navigateWithAgentChatViewTransition(navigate, "/plans?create=1");
  };

  const openPlanPath = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
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
          className="relative w-[calc(100vw-2rem)] max-w-[420px] rounded-xl border-border bg-card p-3 shadow-xl sm:w-[420px]"
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
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const { session, isLoading: sessionLoading } = useSession();
  const t = useT();
  const returnPath = planReturnPathFromLocation(location);

  const secondaryItems: AppSidebarItemDefinition[] = [
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: IconSettings,
      active: pathname.startsWith("/settings"),
    },
  ];

  const feedbackButton = (
    <FeedbackButton variant={collapsed ? "icon" : "sidebar"} side="right" />
  );

  const orgSwitcher = session ? (
    <OrgSwitcher compact={collapsed} />
  ) : !sessionLoading ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={collapsed ? "!size-9 !p-0 text-xs" : "h-8 w-full px-3 text-xs"}
      onClick={() => signInWithReturnPath(returnPath)}
    >
      {collapsed ? "In" : t("sidebar.signIn")}
    </Button>
  ) : null;

  return (
    <AppSidebar
      collapsed={collapsed}
      collapsible={collapsible}
      onCollapsedChange={onCollapsedChange}
      brandName={APP_TITLE}
      brandHref="/plans"
      brandLink={
        <div className="group/brand flex min-w-0 items-center gap-1">
          <Link
            to="/plans"
            className={cn(
              "flex min-w-0 items-center gap-2 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "size-8 justify-center",
            )}
          >
            <AgentNativeIcon
              aria-hidden="true"
              className="h-3.5 w-6 shrink-0 text-primary"
            />
            {!collapsed && (
              <span className="truncate text-sm font-semibold text-primary">
                {APP_TITLE}
              </span>
            )}
          </Link>
          {!collapsed ? <BrandingCustomizePopover /> : null}
        </div>
      }
      secondaryItems={secondaryItems}
      feedback={feedbackButton}
      orgSwitcher={orgSwitcher}
      footerExtras={<DevDatabaseLink />}
    >
      <div>
        <AppSidebarNavItem
          to="/chat"
          label={t("navigation.ask")}
          icon={IconMessageCircle}
          active={pathname === "/chat"}
        />
        <PlanChatsSection collapsed={collapsed} open={pathname === "/chat"} />
      </div>

      <div>
        <AppSidebarNavItem
          to="/plans"
          label={t("navigation.plan")}
          icon={IconClipboardCheck}
          active={
            pathname.startsWith("/plans") ||
            pathname.startsWith("/recaps") ||
            pathname.startsWith("/local-plans")
          }
        />
        {pathname.startsWith("/plans") ||
        pathname.startsWith("/recaps") ||
        pathname.startsWith("/local-plans") ? (
          <PlansSidebarSection collapsed={collapsed} />
        ) : null}
      </div>
    </AppSidebar>
  );
}
