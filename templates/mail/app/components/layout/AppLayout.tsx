import {
  AgentSidebar,
  AgentToggleButton,
} from "@agent-native/core/client/agent-chat";
import { trackEvent } from "@agent-native/core/client/analytics";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import { NotificationsBell } from "@agent-native/core/client/notifications";
import {
  BuilderCreditNotice,
  InvitationBanner,
  OrgSwitcher,
} from "@agent-native/core/client/org";
import {
  AgentNativeIcon,
  AppSidebarFooter,
  AppSidebarHeader,
  EnvironmentBadge,
  FeedbackButton,
  RouterSidebarLink,
} from "@agent-native/core/client/ui";
import { SidebarFooterActions } from "@agent-native/toolkit/app-shell";
import { AI_FILTER_LABEL } from "@shared/ai-filter";
import {
  aiFilterRuleLabelName,
  aiFilterRuleMode,
  normalizedAiFilterLabelId,
} from "@shared/ai-filter-rules";
import { isInboxScopedAppLabel } from "@shared/gmail-labels";
import { ALL_TAB_PARAM, inboxTabHref } from "@shared/inbox-threads";
import { mailSettingsRoute } from "@shared/settings-navigation";
import type { Label, SavedMailFilter } from "@shared/types";
import {
  IconArrowUpRight,
  IconMenu2,
  IconSettings,
  IconSearch,
  IconCheck,
  IconPlus,
  IconPin,
  IconPinnedFilled,
  IconRefresh,
  IconLayoutSidebarLeftCollapse,
  IconX,
  IconFilter,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";

import type { ComposePaletteCommands } from "@/components/email/ComposeModal";
import { SnoozeModal } from "@/components/email/SnoozeModal";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { AiInboxSetup } from "@/components/onboarding/AiInboxSetup";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountFilterContext } from "@/hooks/use-account-filter";
import { useAutomations } from "@/hooks/use-automations";
import {
  applyDraftSaveResult,
  DRAFT_DELETE_FAILED_EVENT,
  DRAFT_SAVE_FAILED_EVENT,
  useComposeState,
} from "@/hooks/use-compose-state";
import { useQueuedDraftCount } from "@/hooks/use-draft-queue";
import {
  useLabels,
  useSettings,
  useUpdateSettings,
  useEmails,
  useReportSpam,
  useBlockSender,
  useMuteThread,
  markExternalEmailRefresh,
  EMPTY_LABELS,
  LABELS_QUERY_KEY,
} from "@/hooks/use-emails";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import {
  INBOX_PAGE_SIZE,
  invalidateInboxThreads,
  mergeOptimisticInboxTabCounts,
  resolveInboxTabId,
  useInboxOverview,
  useInboxSyncPoller,
  useInboxThreads,
} from "@/hooks/use-inbox-threads";
import {
  shouldCycleMailTab,
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { runUndo } from "@/hooks/use-undo";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";
import {
  OTHER_INBOX_TAB_PARAM,
  isInboxScopedLabel,
  pinnedTriageLabels,
  resolvePinnedLabels,
  resolveDefaultMailHref,
  labelTabHref,
  resolveInboxEmailQueryScope,
  filterInboxTabEmails,
} from "@/lib/inbox-tabs";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import { cn } from "@/lib/utils";
import { isKnownMailView } from "@/routes/$view";

import { CommandPalette } from "./CommandPalette";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { SearchBar } from "./SearchBar";
import { useCommandPaletteFocus } from "./use-command-palette-focus";

const ComposeModal = lazy(() =>
  import("@/components/email/ComposeModal").then(({ ComposeModal }) => ({
    default: ComposeModal,
  })),
);

const BARE_ROUTES = new Set(["/email"]);
const EMPTY_SAVED_FILTERS: SavedMailFilter[] = [];

type SnoozeTarget = {
  emailId: string;
  accountEmail?: string;
};
const COMPOSE_FULLSCREEN_PARAM = "composeFullscreen";
const ACCOUNT_POLL_INTERVAL_MS = 2000;
const ACCOUNT_POLL_ABORT_MS = Math.max(10_000, ACCOUNT_POLL_INTERVAL_MS * 4);

function wasMailChatOpen(): boolean {
  try {
    if (window.matchMedia("(max-width: 767px)").matches) return false;
    return (
      localStorage.getItem("agent-native.mail-chat.sidebar-open") === "true"
    );
    // coercion-ok: unreadable saved panel state defaults closed, especially on mobile.
  } catch {
    return false;
  }
}

function mailChatOpenStorageKey(): string {
  return typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches
    ? "mail-chat-mobile"
    : "mail-chat";
}

function AccountAvatar({
  email,
  photoUrl,
  imageClassName,
  fallbackClassName,
}: {
  email: string;
  photoUrl?: string | null;
  imageClassName: string;
  fallbackClassName: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [stablePhotoUrl, setStablePhotoUrl] = useState(photoUrl ?? null);

  useEffect(() => {
    if (!photoUrl || photoUrl === stablePhotoUrl) return;
    setStablePhotoUrl(photoUrl);
    setImageFailed(false);
  }, [photoUrl, stablePhotoUrl]);

  const shouldLoadRemoteAvatar =
    !!stablePhotoUrl && !isMcpEmbedSurface() && !imageFailed;

  if (shouldLoadRemoteAvatar) {
    return (
      <img
        src={stablePhotoUrl}
        alt=""
        className={imageClassName}
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return <div className={fallbackClassName}>{email[0]?.toUpperCase()}</div>;
}

function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function isStandardLayoutPath(pathname: string): boolean {
  return (
    pathname === "/agent" ||
    pathname === "/chat" ||
    pathname === "/team" ||
    pathname === "/draft-queue" ||
    pathname.startsWith("/draft-queue/") ||
    pathname === "/extensions" ||
    pathname.startsWith("/extensions/")
  );
}

function shortLabelName(name: string): string {
  const lastSlash = name.lastIndexOf("/");
  if (lastSlash >= 0) return name.slice(lastSlash + 1).replace(/_/g, " ");
  return name;
}

export function buildLabelDisplayNames(
  labels: readonly Label[],
): Map<string, string> {
  const shortNameCounts = new Map<string, number>();
  for (const label of labels) {
    const shortName = shortLabelName(label.name).toLowerCase();
    shortNameCounts.set(shortName, (shortNameCounts.get(shortName) ?? 0) + 1);
  }

  return new Map<string, string>(
    labels.map((label) => {
      const shortName = shortLabelName(label.name);
      const displayName =
        (shortNameCounts.get(shortName.toLowerCase()) ?? 0) > 1
          ? label.name.replace(/_/g, " ")
          : shortName;
      return [label.id, displayName];
    }),
  );
}

function labelDepth(name: string): number {
  return Math.max(0, name.split("/").length - 1);
}

export interface LabelTreeRow {
  label: Label;
  depth: number;
  displayName: string;
}

export function labelTreeRows(labels: readonly Label[]): LabelTreeRow[] {
  return [...labels]
    .sort((a, b) =>
      a.name
        .toLowerCase()
        .localeCompare(b.name.toLowerCase(), undefined, { numeric: true }),
    )
    .map((label) => ({
      label,
      depth: labelDepth(label.name),
      displayName: shortLabelName(label.name),
    }));
}

export function reorderById<T>(
  items: readonly T[],
  getId: (item: T) => string,
  draggedId: string,
  targetId: string | undefined,
  side: "left" | "right",
): T[] {
  const draggedIndex = items.findIndex((item) => getId(item) === draggedId);
  if (draggedIndex < 0) return [...items];
  const dragged = items[draggedIndex];
  const without = items.filter((item) => getId(item) !== draggedId);
  const targetIndex =
    targetId === undefined
      ? -1
      : without.findIndex((item) => getId(item) === targetId);
  const insertAt =
    targetIndex < 0
      ? without.length
      : side === "left"
        ? targetIndex
        : targetIndex + 1;
  const next = [...without];
  next.splice(insertAt, 0, dragged);
  return next;
}

interface AppLayoutProps {
  children: React.ReactNode;
}

const collapsibleViews = [
  { id: "unread", labelKey: "mail.views.unread" },
  { id: "starred", labelKey: "mail.views.starred" },
  { id: "sent", labelKey: "mail.views.sent" },
  { id: "drafts", labelKey: "mail.views.drafts" },
  { id: "archive", labelKey: "mail.views.archive" },
  { id: "trash", labelKey: "mail.views.trash" },
];
const filteredView = {
  id: AI_FILTER_LABEL,
  labelKey: "mail.aiFilter.filteredMode",
};

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAgentChatRoute = location.pathname === "/chat";

  const t = useT();
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  // Settings brings its own navigation, header, and agent toggle.
  const content = isSettingsPath(location.pathname) ? (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {children}
    </div>
  ) : isStandardLayoutPath(location.pathname) ? (
    <StandardLayout>{children}</StandardLayout>
  ) : (
    <AppLayoutInner>{children}</AppLayoutInner>
  );

  return (
    <AgentSidebar
      enabled={!isAgentChatRoute}
      browserTabId={getBrowserTabId()}
      position="right"
      disableChatShortcut
      defaultOpen={typeof window !== "undefined" && wasMailChatOpen()}
      openStorageKey={mailChatOpenStorageKey()}
      agentPageHref="/settings/agent"
      onFullscreenRequest={() => void navigate("/chat")}
      composerPlaceholder={t("mail.aiFilter.composerPlaceholder")}
      emptyStateText={t("agent.emptyState")}
      dynamicSuggestions={false}
      suggestions={[
        t("agent.ruleSuggestionFilter"),
        t("agent.ruleSuggestionImportant"),
        t("agent.ruleSuggestionArchive"),
      ]}
    >
      {content}
    </AgentSidebar>
  );
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const compose = useComposeState();
  useEffect(() => {
    const handleDraftSaveFailed = () => {
      toast.error(t("mail.toasts.failedToSaveDraft"));
    };
    const handleDraftDeleteFailed = () => {
      toast.error(t("mail.toasts.failedToDeleteDraft"));
    };
    window.addEventListener(DRAFT_SAVE_FAILED_EVENT, handleDraftSaveFailed);
    window.addEventListener(DRAFT_DELETE_FAILED_EVENT, handleDraftDeleteFailed);
    return () => {
      window.removeEventListener(
        DRAFT_SAVE_FAILED_EVENT,
        handleDraftSaveFailed,
      );
      window.removeEventListener(
        DRAFT_DELETE_FAILED_EVENT,
        handleDraftDeleteFailed,
      );
    };
  }, [t]);
  const headerActions = useHeaderActions();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteOpenedFromCompose, setPaletteOpenedFromCompose] =
    useState(false);
  const [composeCommandsAvailable, setComposeCommandsAvailable] =
    useState(false);
  const composePaletteCommandsRef = useRef<ComposePaletteCommands | null>(null);
  const registerComposePaletteCommands = useCallback(
    (commands: ComposePaletteCommands | null) => {
      composePaletteCommandsRef.current = commands;
      setComposeCommandsAvailable(commands !== null);
    },
    [],
  );
  const sendComposeFromCommandPalette = useCallback(() => {
    composePaletteCommandsRef.current?.send();
  }, []);
  const scheduleComposeFromCommandPalette = useCallback(() => {
    composePaletteCommandsRef.current?.sendLater();
  }, []);
  const sendAndMarkDoneFromCommandPalette = useCallback(() => {
    composePaletteCommandsRef.current?.sendAndMarkDone();
  }, []);
  const {
    openPalette: rememberAndOpenPalette,
    handleOpenChange: handlePaletteOpenChange,
    restoreFocusAfterEscape: restorePaletteFocus,
  } = useCommandPaletteFocus(paletteOpen, setPaletteOpen);
  const openPalette = useCallback(() => {
    if (!paletteOpen) {
      const activeElement = document.activeElement;
      setPaletteOpenedFromCompose(
        activeElement instanceof HTMLElement &&
          Boolean(activeElement.closest("[data-mail-compose]")),
      );
    }
    rememberAndOpenPalette();
  }, [paletteOpen, rememberAndOpenPalette]);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeOverride, setSnoozeOverride] = useState<{
    targets: SnoozeTarget[];
  } | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const view = pathSegments[0] || "inbox";
  const threadId = pathSegments[1] || undefined;
  const queuedDrafts = useQueuedDraftCount();
  const [searchParams] = useSearchParams();
  const activeSearchQuery = searchParams.get("q");
  const activeLabel = searchParams.get("label");
  const activeInboxTab = searchParams.get("tab");
  const activeFilterId = searchParams.get("filter");
  const composeInitialExpanded =
    searchParams.get(COMPOSE_FULLSCREEN_PARAM) === "1";
  const clearComposeInitialExpanded = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    if (!next.has(COMPOSE_FULLSCREEN_PARAM)) return;
    next.delete(COMPOSE_FULLSCREEN_PARAM);
    const search = next.toString();
    void navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, navigate, searchParams]);
  const preSearchViewRef = useRef<{
    view: string;
    label: string | null;
    tab: string | null;
    filter: string | null;
  }>({
    view,
    label: activeLabel,
    tab: activeInboxTab,
    filter: activeFilterId,
  });
  useEffect(() => {
    if (!activeSearchQuery) {
      preSearchViewRef.current = {
        view,
        label: activeLabel,
        tab: activeInboxTab,
        filter: activeFilterId,
      };
    }
  }, [view, activeLabel, activeInboxTab, activeFilterId, activeSearchQuery]);
  const restorePreSearchPath = useCallback(() => {
    const { view: v, label: l, tab, filter } = preSearchViewRef.current;
    const params = new URLSearchParams();
    if (l) params.set("label", l);
    if (tab) params.set("tab", tab);
    if (filter) params.set("filter", filter);
    const search = params.toString();
    return `/${v}${search ? `?${search}` : ""}`;
  }, []);
  const prevSearchQueryRef = useRef(activeSearchQuery);
  useEffect(() => {
    if (prevSearchQueryRef.current && !activeSearchQuery) {
      setSearchFocused(false);
      setSearchQuery("");
    }
    prevSearchQueryRef.current = activeSearchQuery;
  }, [activeSearchQuery]);
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const googleStatus = useGoogleAuthStatus();
  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;
  const googleConfigured = googleStatus.data?.configured === true;
  const canOfferGoogleOAuthSetup = useMemo(
    () => shouldOfferGoogleOAuthSetup(),
    [],
  );
  const googleStatusReady = !googleStatus.isLoading && !googleStatus.isError;
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [activeAccounts, setActiveAccounts] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const saved = localStorage.getItem("active-accounts");
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) return new Set<string>(arr);
      }
    } catch {}
    return new Set<string>();
  });
  useEffect(() => {
    if (activeAccounts.size === 0) {
      localStorage.removeItem("active-accounts");
    } else {
      localStorage.setItem(
        "active-accounts",
        JSON.stringify([...activeAccounts]),
      );
    }
  }, [activeAccounts]);
  const { data: labelsData } = useLabels(
    activeAccounts.size > 0 ? [...activeAccounts] : undefined,
  );
  // The Filtered shortcut describes the whole connected mailbox, regardless
  // of which accounts are selected for the current label list.
  const {
    data: connectedLabelsData,
    accountErrors: connectedLabelErrors,
    isError: connectedLabelsFailed,
  } = useLabels();
  const labels = labelsData ?? EMPTY_LABELS;
  const labelDisplayNames = useMemo(
    () => buildLabelDisplayNames(labels),
    [labels],
  );
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [isManuallyRefreshing, setIsManuallyRefreshing] = useState(false);

  const isGoogleConnected = (googleStatus.data?.accounts?.length ?? 0) > 0;
  const userPinnedLabels = settings?.pinnedLabels;
  const combineInbox = settings?.combineInbox === true;
  const showAllTab = settings?.showAllTab !== false;
  const pinnedLabels = useMemo(
    () => resolvePinnedLabels(userPinnedLabels, isGoogleConnected),
    [isGoogleConnected, userPinnedLabels],
  );
  const labelAliases = settings?.labelAliases ?? {};
  const savedFilters = settings?.savedFilters ?? EMPTY_SAVED_FILTERS;
  const activeSavedFilterQuery = savedFilters.find(
    (filter) => filter.id === activeFilterId,
  )?.query;
  const { data: automations = [] } = useAutomations();
  const aiTags = useMemo(() => {
    const tags = new Map<string, { id: string; name: string }>();
    for (const rule of automations) {
      if (
        rule.domain !== "mail" ||
        rule.kind !== "ai-filter" ||
        aiFilterRuleMode(rule) !== "tag"
      ) {
        continue;
      }
      const name = aiFilterRuleLabelName(rule).trim();
      const normalizedName = normalizedAiFilterLabelId(name);
      const id =
        labels.find(
          (label) => normalizedAiFilterLabelId(label.name) === normalizedName,
        )?.id ?? normalizedName;
      if (name && id && !tags.has(normalizedName)) {
        tags.set(normalizedName, { id, name });
      }
    }
    return [...tags.values()];
  }, [automations, labels]);
  const aiTagDisplayNames = useMemo(
    () => new Map(aiTags.map((tag) => [tag.id, tag.name])),
    [aiTags],
  );
  const hasFilteredRule = automations.some(
    (rule) =>
      rule.domain === "mail" &&
      rule.kind === "ai-filter" &&
      aiFilterRuleMode(rule) === "filtered",
  );
  const hasFilteredLabel =
    connectedLabelsFailed ||
    Boolean(connectedLabelErrors?.length) ||
    [connectedLabelsData ?? EMPTY_LABELS, labels].some((labelSet) =>
      labelSet.some(
        (label) =>
          normalizedAiFilterLabelId(label.name) ===
          normalizedAiFilterLabelId(AI_FILTER_LABEL),
      ),
    );
  const hasFilteredPin = userPinnedLabels?.includes(AI_FILTER_LABEL) === true;
  const systemViews = useMemo(
    () =>
      hasFilteredRule || hasFilteredLabel || hasFilteredPin
        ? [...collapsibleViews, filteredView]
        : collapsibleViews,
    [hasFilteredLabel, hasFilteredPin, hasFilteredRule],
  );

  const resolvedInboxTab = resolveInboxTabId(searchParams);
  const inboxAccountEmails =
    activeAccounts.size > 0 ? [...activeAccounts] : undefined;
  useInboxSyncPoller(inboxAccountEmails);
  const inboxThreadInput = {
    tab: resolvedInboxTab,
    accountEmails: inboxAccountEmails,
    limit: INBOX_PAGE_SIZE,
    offset: 0,
  };
  const inboxThreads = useInboxThreads(inboxThreadInput);
  const inboxRawPage = queryClient.getQueryData<
    NonNullable<typeof inboxThreads.data>
  >(["action", "list-inbox-threads", inboxThreadInput]);
  const inboxOverview = useInboxOverview(inboxAccountEmails);
  const inboxMetadata =
    inboxOverview.data ??
    (inboxThreads.isPlaceholderData ? undefined : inboxThreads.data);
  const inboxTabs = useMemo(() => {
    const tabs = inboxMetadata?.tabs ?? [];
    if (!inboxOverview.data || inboxThreads.isPlaceholderData) {
      return tabs;
    }
    return mergeOptimisticInboxTabCounts(
      inboxOverview.data,
      inboxRawPage,
      inboxThreads.data,
    );
  }, [
    inboxMetadata?.tabs,
    inboxOverview.data,
    inboxThreads.data,
    inboxThreads.isPlaceholderData,
    inboxRawPage,
  ]);
  const activeInboxTabId = inboxThreads.isPlaceholderData
    ? (resolvedInboxTab ?? inboxThreads.data?.tabs[0]?.id)
    : (inboxThreads.data?.activeTabId ?? resolvedInboxTab);
  const inboxIsFetching = inboxThreads.isFetching;
  const inboxSyncing =
    inboxMetadata?.syncing === true ||
    inboxMetadata?.accounts.some(
      (account) =>
        account.state === "ready" && account.backfillPending === true,
    );
  const needsReauthAccount = inboxMetadata?.accounts.find(
    (account) => account.state === "needs_reauth",
  );

  const { data: rawAllLocalEmails = [] } = useEmails(
    "all",
    undefined,
    undefined,
    {
      enabled: googleStatusReady && !hasAccounts,
    },
  );
  const hasLocalMailboxData =
    !hasAccounts &&
    (rawAllLocalEmails.length > 0 ||
      (inboxThreads.data?.items.length ?? 0) > 0 ||
      labels.some(
        (label) => (label.totalCount ?? 0) > 0 || (label.unreadCount ?? 0) > 0,
      ));
  const tabsLoading =
    (inboxThreads.isLoading && !inboxThreads.data) ||
    (settingsLoading && !settings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarPinPreferenceLoaded, setSidebarPinPreferenceLoaded] =
    useState(false);
  useEffect(() => {
    setSidebarPinned(
      window.localStorage.getItem("mail-sidebar-pinned") === "true",
    );
    setSidebarPinPreferenceLoaded(true);
  }, []);
  useEffect(() => {
    if (!sidebarPinPreferenceLoaded) return;
    if (sidebarPinned)
      window.localStorage.setItem("mail-sidebar-pinned", "true");
    else window.localStorage.removeItem("mail-sidebar-pinned");
  }, [sidebarPinned, sidebarPinPreferenceLoaded]);
  const isPinnedSidebarVisible = !isMobile && sidebarPinned;
  const closeSidebar = useCallback(() => {
    if (!isPinnedSidebarVisible) setSidebarOpen(false);
  }, [isPinnedSidebarVisible]);
  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      if (isPinnedSidebarVisible) return;
      setSidebarOpen(open);
    },
    [isPinnedSidebarVisible],
  );
  const feedbackButton = <FeedbackButton variant="sidebar" side="right" />;

  type DragItem = { group: "label" | "filter"; id: string };
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    tabIndex: number;
    side: "left" | "right";
  } | null>(null);

  type RenderedTab = {
    id: string;
    pinnedId?: string;
    filterId?: string;
    label: string;
    fullLabel?: string;
    href: string;
    isActive: boolean;
    color?: string;
    tooltip?: string;
    total?: number;
    totalIsLowerBound?: boolean;
    unread?: number;
    isSystemView: boolean;
  };

  const systemViewTabs = useMemo<RenderedTab[]>(() => {
    if (combineInbox) return [];
    return pinnedLabels
      .filter((id) => systemViews.some((v) => v.id === id))
      .map((id) => {
        const sysView = systemViews.find((v) => v.id === id)!;
        return {
          id: sysView.id,
          label: t(sysView.labelKey),
          href:
            sysView.id === AI_FILTER_LABEL
              ? labelTabHref(AI_FILTER_LABEL)
              : `/${sysView.id}`,
          isActive:
            sysView.id === AI_FILTER_LABEL
              ? view === "all" && activeLabel === AI_FILTER_LABEL
              : view === sysView.id,
          isSystemView: true,
        };
      });
  }, [activeLabel, combineInbox, pinnedLabels, systemViews, view, t]);

  const dataTabs = useMemo<RenderedTab[]>(() => {
    return inboxTabs.map((tab) => {
      const label = labels.find((l) => l.id === tab.id);
      const aiTagName = aiTagDisplayNames.get(tab.id);
      return {
        id: tab.id,
        pinnedId: tab.kind === "label" ? tab.id : undefined,
        filterId: tab.kind === "filter" ? tab.id : undefined,
        label:
          tab.kind === "all" ? t("mail.views.all") : (aiTagName ?? tab.name),
        fullLabel: aiTagName ?? label?.name,
        href: inboxTabHref(tab.id),
        isActive: view === "inbox" && activeInboxTabId === tab.id,
        color: label?.color,
        tooltip: tab.query,
        total: tab.total,
        totalIsLowerBound: tab.totalIsLowerBound,
        unread: tab.unread,
        isSystemView: false,
      };
    });
  }, [aiTagDisplayNames, inboxTabs, activeInboxTabId, labels, t, view]);

  const topBarTabs = useMemo<RenderedTab[]>(
    () => [...systemViewTabs, ...(view === "inbox" ? dataTabs : [])],
    [systemViewTabs, dataTabs, view],
  );

  const hiddenViews = useMemo(
    () => systemViews.filter((v) => !pinnedLabels.includes(v.id)),
    [pinnedLabels, systemViews],
  );

  const mobileInboxTabs = dataTabs;

  // Is current view one of the hidden ones? If so force-show it
  const currentHiddenView = hiddenViews.find(
    (v) =>
      v.id === view ||
      (v.id === AI_FILTER_LABEL &&
        view === "all" &&
        activeLabel === AI_FILTER_LABEL),
  );
  const currentInHidden = currentHiddenView !== undefined;

  const userLabels = useMemo(() => {
    const aiTagIds = new Set(aiTags.map((tag) => tag.id));
    const filtered = labels.filter(
      (l) =>
        !["inbox", ...systemViews.map((v) => v.id)].includes(l.id) &&
        !aiTagIds.has(l.id) &&
        !aiTagIds.has(normalizedAiFilterLabelId(l.name)),
    );
    return filtered;
  }, [aiTags, labels, systemViews]);

  const handleCompose = useCallback(() => {
    trackEvent("compose_opened", {
      app_name: "mail",
      template_name: "mail",
      compose_mode: "new",
    });
    compose.open({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      mode: "compose",
    });
  }, [compose]);

  const isMailboxView = [
    "inbox",
    "starred",
    "sent",
    "drafts",
    "archive",
    "trash",
    "snoozed",
    "scheduled",
    "all",
  ].includes(view);
  const shellSearchQuery =
    activeSavedFilterQuery ?? activeSearchQuery ?? undefined;
  const shellQueryScope = resolveInboxEmailQueryScope({
    view,
    activeLabel,
    activeInboxTab,
    activeLabelIsInboxScoped: isInboxScopedLabel(activeLabel, labels),
    activeSavedFilter: activeSavedFilterQuery !== undefined,
    combineInbox,
    triageLabels: pinnedTriageLabels(pinnedLabels),
    searchQuery: shellSearchQuery,
  });
  const useInboxThreadsForActionTargets =
    view === "inbox" &&
    hasAccounts &&
    activeSearchQuery === null &&
    activeSavedFilterQuery === undefined &&
    activeLabel === null;
  const {
    data: legacyCurrentViewEmails = [],
    isPlaceholderData: legacyCurrentViewEmailsArePlaceholder,
  } = useEmails(
    isMailboxView ? shellQueryScope.emailView : "inbox",
    shellSearchQuery,
    shellQueryScope.effectiveLabel,
    {
      enabled:
        isMailboxView &&
        (view !== "inbox" ||
          (hasAccounts ? !useInboxThreadsForActionTargets : googleStatusReady)),
    },
  );
  const currentViewEmails = useInboxThreadsForActionTargets
    ? (inboxThreads.data?.items ?? [])
    : legacyCurrentViewEmails;
  const currentViewEmailsArePlaceholder = useInboxThreadsForActionTargets
    ? inboxThreads.isPlaceholderData
    : legacyCurrentViewEmailsArePlaceholder;
  const actionTargetTab =
    view === "inbox" &&
    !combineInbox &&
    !activeSearchQuery &&
    !activeSavedFilterQuery &&
    (activeInboxTabId === OTHER_INBOX_TAB_PARAM ||
      pinnedTriageLabels(pinnedLabels).includes(activeInboxTabId ?? ""))
      ? activeInboxTabId
      : undefined;
  const actionTargetEmails = useMemo(
    () =>
      currentViewEmailsArePlaceholder
        ? []
        : actionTargetTab === undefined
          ? currentViewEmails
          : filterInboxTabEmails(
              currentViewEmails,
              actionTargetTab === OTHER_INBOX_TAB_PARAM
                ? null
                : actionTargetTab,
              pinnedLabels,
              savedFilters.map((filter) => filter.query),
            ),
    [
      actionTargetTab,
      currentViewEmails,
      currentViewEmailsArePlaceholder,
      pinnedLabels,
      savedFilters,
    ],
  );
  const reportSpam = useReportSpam();
  const blockSender = useBlockSender();
  const muteThread = useMuteThread();

  const [focusedListId, setFocusedListId] = useState<string | null>(null);

  useEffect(() => {
    if (threadId) return;
    const fetchNav = async () => {
      try {
        const res = await fetch(
          agentNativePath(
            `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
          ),
        );
        if (res.ok) {
          const nav = await res.json();
          if (nav?.focusedEmailId) setFocusedListId(nav.focusedEmailId);
        }
      } catch {}
    };
    void fetchNav();
    if (paletteOpen) void fetchNav();
  }, [threadId, paletteOpen]);

  const targetEmail = useMemo(() => {
    if (threadId) {
      return actionTargetEmails.find((e) => (e.threadId || e.id) === threadId);
    }
    if (focusedListId) {
      const focused = actionTargetEmails.find((e) => e.id === focusedListId);
      if (focused) return focused;
    }
    return actionTargetEmails[0] ?? undefined;
  }, [threadId, focusedListId, actionTargetEmails]);

  const dismissEmail = useCallback((emailId: string) => {
    window.dispatchEvent(
      new CustomEvent("email:snoozed", { detail: { emailId } }),
    );
  }, []);

  const handleSpam = useCallback(() => {
    if (!targetEmail) {
      toast.error(t("mail.toasts.noEmailSelected"));
      return;
    }
    dismissEmail(targetEmail.id);
    reportSpam.mutate({
      id: targetEmail.id,
      threadId: targetEmail.threadId || targetEmail.id,
      accountEmail: targetEmail.accountEmail,
    });
    toast(t("mail.toasts.reportedSpam"));
  }, [targetEmail, reportSpam, dismissEmail, t]);

  const handleBlockSender = useCallback(() => {
    if (!targetEmail) {
      toast.error(t("mail.toasts.noEmailSelected"));
      return;
    }
    dismissEmail(targetEmail.id);
    blockSender.mutate({
      id: targetEmail.id,
      threadId: targetEmail.threadId || targetEmail.id,
      senderEmail: targetEmail.from.email,
      accountEmail: targetEmail.accountEmail,
    });
    toast(
      t("mail.toasts.reportedSpamBlocked", { email: targetEmail.from.email }),
    );
  }, [targetEmail, blockSender, dismissEmail, t]);

  const handleMuteThread = useCallback(() => {
    const tid =
      threadId ||
      (targetEmail ? targetEmail.threadId || targetEmail.id : undefined);
    if (!tid) {
      toast.error(t("mail.toasts.noThreadSelected"));
      return;
    }
    if (targetEmail) dismissEmail(targetEmail.id);
    muteThread.mutate({
      threadId: tid,
      accountEmail: targetEmail?.accountEmail,
    });
    toast(t("mail.toasts.threadMuted"));
  }, [threadId, targetEmail, muteThread, dismissEmail, t]);

  const togglePinned = useCallback(
    (id: string) => {
      const current = pinnedLabels;
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateSettings.mutate({ pinnedLabels: next });
    },
    [pinnedLabels, updateSettings],
  );

  const handleAllTabChange = useCallback(
    (next: boolean) => {
      updateSettings.mutate({ showAllTab: next });
      if (
        next ||
        view !== "inbox" ||
        threadId ||
        activeInboxTab !== ALL_TAB_PARAM
      ) {
        return;
      }
      void navigate(
        resolveDefaultMailHref({
          combineInbox,
          showAllTab: false,
          pinnedLabels,
          savedFilters,
          isGoogleConnected,
        }),
        { replace: true },
      );
    },
    [
      activeInboxTab,
      combineInbox,
      isGoogleConnected,
      navigate,
      pinnedLabels,
      savedFilters,
      threadId,
      updateSettings,
      view,
    ],
  );

  const handleCombinedInboxChange = useCallback(
    (next: boolean) => {
      updateSettings.mutate({ combineInbox: next });
      if (next) {
        if (
          view !== "inbox" ||
          (!isInboxScopedAppLabel(activeLabel) &&
            activeInboxTab !== OTHER_INBOX_TAB_PARAM &&
            activeInboxTab !== ALL_TAB_PARAM)
        ) {
          return;
        }
        const nextParams = new URLSearchParams(location.search);
        nextParams.delete("label");
        nextParams.delete("tab");
        const search = nextParams.toString();
        void navigate({
          pathname: "/inbox",
          search: search ? `?${search}` : "",
        });
        return;
      }
      if (
        view !== "inbox" ||
        threadId ||
        activeLabel ||
        activeInboxTab ||
        activeFilterId ||
        activeSearchQuery
      ) {
        return;
      }
      const splitRoute = resolveDefaultMailHref({
        combineInbox: false,
        showAllTab,
        pinnedLabels,
        savedFilters,
        isGoogleConnected,
      });
      if (splitRoute !== "/inbox") {
        void navigate(splitRoute, { replace: true });
      }
    },
    [
      activeInboxTab,
      activeLabel,
      activeFilterId,
      activeSearchQuery,
      isGoogleConnected,
      location.search,
      navigate,
      pinnedLabels,
      savedFilters,
      showAllTab,
      threadId,
      updateSettings,
      view,
    ],
  );

  const saveSearchAsFilter = useCallback(
    async (query: string, name: string) => {
      const normalizedQuery = query.trim().slice(0, 500);
      const normalizedName = name.trim().slice(0, 80);
      if (!normalizedQuery || !normalizedName) return;
      if (savedFilters.length >= 20) {
        throw new Error(t("mail.search.filtersLimitReached"));
      }

      const existing = savedFilters.find(
        (filter) =>
          filter.query.trim().toLowerCase() === normalizedQuery.toLowerCase(),
      );
      if (existing) {
        void navigate(`/inbox?filter=${encodeURIComponent(existing.id)}`);
        return;
      }

      const id = `filter-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const filter: SavedMailFilter = {
        id,
        name: normalizedName,
        query: normalizedQuery,
      };
      try {
        await updateSettings.mutateAsync({
          savedFilters: [...savedFilters, filter],
        });
      } catch {
        throw new Error(t("mail.search.saveAsTabFailed"));
      }
      void navigate(`/inbox?filter=${encodeURIComponent(id)}`);
    },
    [navigate, savedFilters, t, updateSettings],
  );

  const removeSavedFilter = useCallback(
    (id: string) => {
      updateSettings.mutate({
        savedFilters: savedFilters.filter((filter) => filter.id !== id),
      });
      if (activeFilterId === id) void navigate("/inbox");
    },
    [activeFilterId, navigate, savedFilters, updateSettings],
  );

  const handleTabDragStart = useCallback(
    (e: React.DragEvent, item: DragItem) => {
      setDragItem(item);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, tabIndex: number) => {
      if (!dragItem) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      setDropIndicator({
        tabIndex,
        side: e.clientX < midX ? "left" : "right",
      });
    },
    [dragItem],
  );

  const handleTabDrop = useCallback(() => {
    if (!dragItem || !dropIndicator) return;
    const targetTab = topBarTabs[dropIndicator.tabIndex];
    if (!targetTab) return;

    if (dragItem.group === "label") {
      if (!pinnedLabels.includes(dragItem.id)) return;
      updateSettings.mutate({
        pinnedLabels: reorderById(
          pinnedLabels,
          (id) => id,
          dragItem.id,
          targetTab.pinnedId,
          dropIndicator.side,
        ),
      });
    } else {
      if (!savedFilters.some((filter) => filter.id === dragItem.id)) return;
      updateSettings.mutate({
        savedFilters: reorderById(
          savedFilters,
          (filter) => filter.id,
          dragItem.id,
          targetTab.filterId,
          dropIndicator.side,
        ),
      });
    }
    setDragItem(null);
    setDropIndicator(null);
  }, [
    dragItem,
    dropIndicator,
    pinnedLabels,
    savedFilters,
    topBarTabs,
    updateSettings,
  ]);

  const handleTabDragEnd = useCallback(() => {
    setDragItem(null);
    setDropIndicator(null);
  }, []);

  const cycleTab = useCallback(
    (reverse?: boolean) => {
      if (topBarTabs.length < 2) return;
      const activeIdx = topBarTabs.findIndex((tab) => tab.isActive);
      const delta = reverse ? -1 : 1;
      let nextIdx: number;
      if (activeIdx === -1) {
        nextIdx = reverse ? topBarTabs.length - 1 : 0;
      } else {
        nextIdx = (activeIdx + delta + topBarTabs.length) % topBarTabs.length;
      }
      void navigate(topBarTabs[nextIdx].href);
    },
    [topBarTabs, navigate],
  );

  const canCycleTab = useCallback(
    (event: KeyboardEvent) => {
      if (topBarTabs.length < 2) return false;
      return shouldCycleMailTab(event.target);
    },
    [topBarTabs.length],
  );

  const handleSnooze = useCallback(() => {
    const listSnoozeEvent = new CustomEvent("email:shortcut-snooze", {
      cancelable: true,
    });
    window.dispatchEvent(listSnoozeEvent);
    if (listSnoozeEvent.defaultPrevented) return;

    if (!targetEmail) {
      toast.error(t("mail.toasts.noEmailSelected"));
      return;
    }
    setSnoozeOverride(null);
    setSnoozeOpen(true);
  }, [targetEmail]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          emailId?: string;
          accountEmail?: string;
          targets?: SnoozeTarget[];
        }>
      ).detail;
      const targets =
        detail?.targets?.filter((target) => target.emailId) ??
        (detail?.emailId
          ? [{ emailId: detail.emailId, accountEmail: detail.accountEmail }]
          : []);
      if (targets.length === 0) return;
      setSnoozeOverride({
        targets,
      });
      setSnoozeOpen(true);
    };
    window.addEventListener("email:request-snooze", handler);
    return () => window.removeEventListener("email:request-snooze", handler);
  }, []);

  useKeyboardShortcuts([
    {
      key: "k",
      meta: true,
      handler: openPalette,
      skipInInput: false,
    },
    {
      key: "/",
      shift: "either",
      handler: () => {
        document.getElementById("mail-search")?.focus();
      },
    },
    { key: "c", handler: handleCompose },
    { key: "h", handler: handleSnooze },
    { key: "!", shift: true, handler: handleSpam },
    { key: "z", handler: runUndo },
    {
      key: "Tab",
      shouldHandle: canCycleTab,
      handler: () => cycleTab(false),
      skipInInput: false,
    },
    {
      key: "Tab",
      shift: true,
      shouldHandle: canCycleTab,
      handler: () => cycleTab(true),
      skipInInput: false,
    },
    {
      key: "Escape",
      shouldHandle: () => Boolean(activeSearchQuery || searchFocused),
      handler: () => {
        setSearchQuery("");
        setSearchFocused(false);
        (document.getElementById("mail-search") as HTMLInputElement)?.blur();
        if (activeSearchQuery) {
          void navigate(restorePreSearchPath());
        }
      },
    },
  ]);

  useEffect(() => {
    const handler = openPalette;
    window.addEventListener("agent-native:open-command-menu", handler);
    return () =>
      window.removeEventListener("agent-native:open-command-menu", handler);
  }, [openPalette]);

  useSequenceShortcuts([
    {
      keys: ["g", "i"],
      handler: () => {
        void navigate("/inbox");
        void queryClient.invalidateQueries({ queryKey: ["emails"] });
        void queryClient.invalidateQueries({ queryKey: LABELS_QUERY_KEY });
        void invalidateInboxThreads(queryClient);
      },
    },
    { keys: ["g", "s"], handler: () => navigate("/starred") },
    { keys: ["g", "t"], handler: () => navigate("/sent") },
    { keys: ["g", "d"], handler: () => navigate("/drafts") },
    { keys: ["g", "a"], handler: () => navigate("/all") },
    { keys: ["g", "e"], handler: () => navigate("/archive") },
    { keys: ["g", "#"], handler: () => navigate("/trash") },
  ]);

  const inboxSidebarUnreadCount = inboxMetadata?.labels.find(
    (label) => label.id === "inbox",
  )?.unreadCount;

  const accountFilterValue = useMemo(
    () => ({ activeAccounts, allAccounts: accounts }),
    [activeAccounts, accounts],
  );

  return (
    <AccountFilterContext.Provider value={accountFilterValue}>
      <div className="relative flex flex-1 flex-col overflow-hidden bg-background">
        {/* Top nav bar */}
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border/50 bg-card px-2 inbox-zero-header hide-scrollbar">
          <Dialog
            open={sidebarOpen || isPinnedSidebarVisible}
            modal={!isPinnedSidebarVisible}
            onOpenChange={handleSidebarOpenChange}
          >
            {/* Hamburger menu */}
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <button
                    onClick={() => {
                      if (isPinnedSidebarVisible) {
                        setSidebarPinned(false);
                        setSidebarOpen(false);
                      }
                    }}
                    className="sticky start-0 z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded bg-card text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors sm:h-7 sm:w-7"
                    aria-label={t("mail.toolbar.toggleMenu")}
                  >
                    <IconMenu2 className="h-4 w-4" />
                  </button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("mail.toolbar.menu")}</TooltipContent>
            </Tooltip>

            {/* Sidebar drawer */}
            <DialogContent
              hideClose
              aria-describedby={undefined}
              aria-modal={!isPinnedSidebarVisible}
              onOpenAutoFocus={(event) => {
                if (isPinnedSidebarVisible) event.preventDefault();
              }}
              overlayClassName={isPinnedSidebarVisible ? "hidden" : undefined}
              className={cn(
                "inset-y-0 start-0 left-0 right-auto flex h-dvh w-[260px] max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-e border-border bg-sidebar p-0 shadow-none rtl:left-auto rtl:right-0",
                isPinnedSidebarVisible && "top-12 bottom-0 h-auto",
              )}
            >
              <DialogTitle className="sr-only">{t("mail.appName")}</DialogTitle>
              <div className="agent-layout-left-drawer flex min-h-0 flex-1 flex-col overflow-hidden">
                <AppSidebarHeader
                  brandName={t("mail.appName")}
                  appId="mail"
                  brandHref="/inbox"
                  collapsed={false}
                >
                  <div className="ms-auto flex items-center gap-1">
                    {!isMobile && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              if (sidebarPinned) {
                                setSidebarPinned(false);
                                setSidebarOpen(true);
                                return;
                              }
                              setSidebarPinned(true);
                              setSidebarOpen(false);
                            }}
                            className={cn(
                              "flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              sidebarPinned && "text-foreground bg-accent/50",
                            )}
                            aria-label={
                              sidebarPinned
                                ? t("mail.toolbar.unpinSidebar")
                                : t("mail.toolbar.pinSidebar")
                            }
                          >
                            {sidebarPinned ? (
                              <IconPinnedFilled className="h-4 w-4" />
                            ) : (
                              <IconPin className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {sidebarPinned
                            ? t("mail.toolbar.unpinSidebar")
                            : t("mail.toolbar.pinSidebar")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!isPinnedSidebarVisible && (
                      <DialogClose asChild>
                        <button
                          type="button"
                          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          aria-label={t("mail.toolbar.closeSidebar")}
                        >
                          <IconX className="h-4 w-4" />
                        </button>
                      </DialogClose>
                    )}
                  </div>
                </AppSidebarHeader>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {/* Accounts */}
                  {hasAccounts && (
                    <div className="px-4 pt-5 pb-4 border-b border-border/20">
                      <div className="space-y-2">
                        {accounts.map((account) => {
                          const isActive =
                            activeAccounts.size === 0 ||
                            activeAccounts.has(account.email);
                          return (
                            <button
                              key={account.email}
                              onClick={() => {
                                setActiveAccounts((prev) => {
                                  const next = new Set(prev);
                                  if (next.size === 0) {
                                    for (const a of accounts) {
                                      if (a.email !== account.email)
                                        next.add(a.email);
                                    }
                                  } else if (next.has(account.email)) {
                                    next.delete(account.email);
                                    if (next.size === 0) return new Set();
                                  } else {
                                    next.add(account.email);
                                    if (next.size === accounts.length)
                                      return new Set();
                                  }
                                  return next;
                                });
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start transition-opacity",
                                isActive ? "opacity-100" : "opacity-30",
                              )}
                            >
                              <AccountAvatar
                                email={account.email}
                                photoUrl={account.photoUrl}
                                imageClassName="h-8 w-8 rounded-full object-cover shrink-0"
                                fallbackClassName="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-[12px] font-semibold text-primary shrink-0"
                              />
                              <span className="text-[13px] text-foreground truncate">
                                {account.email}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="px-2 py-3">
                    <div className="space-y-0.5">
                      {[
                        {
                          id: "inbox",
                          label: t("mail.views.inbox"),
                          href: "/inbox",
                        },
                        {
                          id: "unread",
                          label: t("mail.views.unread"),
                          href: "/unread",
                        },
                        {
                          id: "starred",
                          label: t("mail.views.starred"),
                          href: "/starred",
                        },
                        {
                          id: "snoozed",
                          label: t("mail.views.snoozed"),
                          href: "/snoozed",
                        },
                        {
                          id: "sent",
                          label: t("mail.views.sent"),
                          href: "/sent",
                        },
                        {
                          id: "draft-queue",
                          label: t("mail.views.draftQueue"),
                          href: "/draft-queue",
                        },
                        {
                          id: "scheduled",
                          label: t("mail.views.scheduled"),
                          href: "/scheduled",
                        },
                        {
                          id: "drafts",
                          label: t("mail.views.drafts"),
                          href: "/drafts",
                        },
                        {
                          id: "archive",
                          label: t("mail.views.archive"),
                          href: "/archive",
                        },
                        {
                          id: "trash",
                          label: t("mail.views.trash"),
                          href: "/trash",
                        },
                      ].map((item) => (
                        <Link
                          key={item.id}
                          to={item.href}
                          onClick={closeSidebar}
                          className={cn(
                            "flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                            view === item.id
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-primary hover:bg-accent/60",
                          )}
                        >
                          <span>{item.label}</span>
                          {item.id === "draft-queue" &&
                            queuedDrafts.count > 0 && (
                              <span className="text-[12px] text-amber-300 tabular-nums">
                                {queuedDrafts.count}
                              </span>
                            )}
                          {item.id === "inbox" &&
                            !!inboxSidebarUnreadCount &&
                            inboxSidebarUnreadCount > 0 && (
                              <span className="text-[12px] text-muted-foreground/50 tabular-nums">
                                {inboxSidebarUnreadCount}
                              </span>
                            )}
                        </Link>
                      ))}
                    </div>

                    {/* Mobile equivalents for the hidden top-bar inbox tabs */}
                    {mobileInboxTabs.length > 0 && (
                      <>
                        <h2 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mt-5 mb-3">
                          {t("mail.views.labels")}
                        </h2>
                        <div className="space-y-0.5">
                          {mobileInboxTabs.map((tab) => {
                            const count = tab.unread;
                            const depth = tab.fullLabel
                              ? labelDepth(tab.fullLabel)
                              : 0;
                            return (
                              <Link
                                key={tab.id}
                                to={tab.href}
                                onClick={closeSidebar}
                                className={cn(
                                  "flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                                  tab.isActive
                                    ? "bg-primary/10 font-medium text-primary"
                                    : "text-primary hover:bg-accent/60",
                                )}
                              >
                                <span
                                  className="flex min-w-0 items-center gap-2"
                                  style={{ paddingLeft: depth * 12 }}
                                >
                                  {tab.color && (
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: tab.color }}
                                    />
                                  )}
                                  <span
                                    className="truncate"
                                    title={tab.fullLabel ?? tab.label}
                                  >
                                    {tab.label}
                                  </span>
                                </span>
                                {count !== undefined && count > 0 && (
                                  <span className="text-[12px] text-muted-foreground/50 tabular-nums">
                                    {count}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <BuilderCreditNotice className="mx-2 mb-2 shrink-0" />
                <AppSidebarFooter
                  collapsed={false}
                  collapsible={false}
                  feedback={feedbackButton}
                  orgSwitcher={
                    <OrgSwitcher
                      compact={false}
                      hideBuilderCreditNotice
                      className="min-w-0 flex-1 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
                    />
                  }
                  footerExtras={
                    <>
                      <DevDatabaseLink />
                      <ThemeToggle className="size-9 shrink-0 !bg-transparent text-primary hover:!bg-accent/60 hover:!text-primary" />
                    </>
                  }
                />
              </div>
            </DialogContent>
          </Dialog>

          {/* Primary tabs stay mounted during search so navigation does not jump. */}
          <>
            {tabsLoading ? (
              <nav className="flex w-max shrink-0 items-center gap-2 sm:w-auto sm:flex-1 sm:min-w-0 sm:overflow-x-auto sm:hide-scrollbar">
                {[96, 128, 98, 72, 84, 62].map((width, index) => (
                  <span
                    key={index}
                    className="h-8 shrink-0 rounded-md bg-muted animate-pulse"
                    style={{ width }}
                  />
                ))}
              </nav>
            ) : (
              <nav
                className="flex w-max shrink-0 flex-nowrap items-center gap-1 sm:w-auto sm:flex-1 sm:min-w-0 sm:overflow-x-auto sm:hide-scrollbar"
                data-mail-tab-list
              >
                {topBarTabs.map((tab, tabIndex) => {
                  const count = tab.total;
                  const dragItemForTab: DragItem | undefined = tab.pinnedId
                    ? { group: "label", id: tab.pinnedId }
                    : tab.filterId
                      ? { group: "filter", id: tab.filterId }
                      : undefined;
                  const canDrag = !!dragItemForTab;
                  const showLeft =
                    dropIndicator?.tabIndex === tabIndex &&
                    dropIndicator.side === "left";
                  const showRight =
                    dropIndicator?.tabIndex === tabIndex &&
                    dropIndicator.side === "right";
                  const link = (
                    <RouterSidebarLink
                      to={tab.href}
                      aria-current={tab.isActive ? "page" : undefined}
                      draggable={canDrag}
                      onDragStart={(e) =>
                        dragItemForTab && handleTabDragStart(e, dragItemForTab)
                      }
                      onDragEnd={handleTabDragEnd}
                      className={cn(
                        "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors",
                        tab.isActive
                          ? "bg-accent text-foreground font-semibold"
                          : "text-muted-foreground font-medium hover:bg-accent/50 hover:text-foreground/80",
                      )}
                    >
                      {tab.color && (
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: tab.color }}
                        />
                      )}
                      {tab.label}
                      {count !== undefined && count > 0 && (
                        <span
                          aria-label={
                            tab.totalIsLowerBound
                              ? t("mail.inbox.atLeastCount", { count })
                              : undefined
                          }
                          className={cn(
                            "text-[11px] tabular-nums",
                            tab.isActive
                              ? "text-foreground/60"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {tab.totalIsLowerBound ? `${count}+` : count}
                        </span>
                      )}
                    </RouterSidebarLink>
                  );
                  return (
                    <div
                      key={tab.pinnedId || tab.id}
                      className="relative flex shrink-0 items-center"
                      onDragOver={(e) => handleTabDragOver(e, tabIndex)}
                      onDrop={handleTabDrop}
                    >
                      {showLeft && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-full z-10" />
                      )}
                      {tab.tooltip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent>{tab.tooltip}</TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                      {showRight && (
                        <div className="absolute right-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-full z-10" />
                      )}
                    </div>
                  );
                })}

                {/* If navigated to an unpinned view (e.g. via keyboard shortcut), show it */}
                {currentInHidden && (
                  <span className="flex shrink-0 items-center whitespace-nowrap px-2.5 py-1 text-[13px] text-foreground font-semibold">
                    {t(currentHiddenView?.labelKey ?? "mail.views.inbox")}
                  </span>
                )}
              </nav>
            )}

            {/* Tab settings cog */}
            <div
              className={cn("relative shrink-0", tabsLoading && "invisible")}
            >
              <Popover
                open={tabSettingsOpen}
                onOpenChange={(open) => {
                  setTabSettingsOpen(open);
                  if (!open) setLabelSearch("");
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded transition-colors sm:h-6 sm:w-6",
                          tabSettingsOpen
                            ? "text-foreground bg-accent/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
                        )}
                        aria-label={t("mail.toolbar.configureTabs")}
                      >
                        <IconSettings className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("mail.toolbar.configureTabs")}
                  </TooltipContent>
                </Tooltip>
                <PopoverContent
                  align="start"
                  className="w-60 max-w-[calc(100vw-2rem)] p-0"
                >
                  <Link
                    to={`${mailSettingsRoute("ai-filter")}#tags`}
                    onClick={() => setTabSettingsOpen(false)}
                    className="flex items-center gap-2 border-b border-border/30 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/50"
                  >
                    <IconFilter className="size-3.5 text-primary" />
                    <span className="flex-1">
                      {t("mail.toolbar.aiSettings")}
                    </span>
                    <IconArrowUpRight className="size-3.5 text-muted-foreground" />
                  </Link>
                  <TabSettingsPopover
                    systemViews={systemViews}
                    aiTags={aiTags}
                    labels={labels}
                    userLabels={userLabels}
                    labelDisplayNames={labelDisplayNames}
                    pinnedLabels={pinnedLabels}
                    combinedInbox={combineInbox}
                    showSplitInbox={accounts.length > 1}
                    allTabVisible={showAllTab}
                    savedFilters={savedFilters}
                    labelAliases={labelAliases}
                    search={labelSearch}
                    onSearchChange={setLabelSearch}
                    onToggle={togglePinned}
                    onAllTabChange={handleAllTabChange}
                    onCombinedInboxChange={handleCombinedInboxChange}
                    onRemoveFilter={removeSavedFilter}
                    onRename={(id, alias) => {
                      const next = { ...labelAliases };
                      if (alias) next[id] = alias;
                      else delete next[id];
                      updateSettings.mutate({ labelAliases: next });
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </>

          {inboxSyncing && (
            <span
              className="flex shrink-0 items-center text-muted-foreground"
              role="status"
              aria-label={t("mail.inbox.syncing")}
              title={t("mail.inbox.syncing")}
            >
              <IconRefresh
                aria-hidden="true"
                className="h-3 w-3 animate-spin"
              />
            </span>
          )}

          {headerActions && (
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
            </div>
          )}

          {/* Search — stays visible while a search is active so the
                  user always knows what they searched */}
          {searchFocused || activeSearchQuery ? (
            <SearchBar
              initialQuery={activeSearchQuery ?? ""}
              autoFocus={searchFocused && !activeSearchQuery}
              hasActiveSearch={!!activeSearchQuery}
              onSaveSearch={saveSearchAsFilter}
              onClose={() => {
                setSearchFocused(false);
                setSearchQuery("");
                if (activeSearchQuery) {
                  void navigate(restorePreSearchPath());
                }
              }}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSearchFocused(true)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors sm:h-7 sm:w-7"
                  aria-label={t("mail.search.label")}
                >
                  <IconSearch className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("mail.search.label")}</TooltipContent>
            </Tooltip>
          )}

          {/* Hidden input for keyboard shortcut target */}
          {!searchFocused && !activeSearchQuery && (
            <input
              id="mail-search"
              aria-label={t("mail.search.label")}
              className="sr-only"
              tabIndex={-1}
              onFocus={() => setSearchFocused(true)}
            />
          )}

          {/* Manual refresh — auto-poll backs off on error, but users
                  still want a button to force a fresh fetch on demand. The
                  spin animation only fires on user click, never on background
                  poll-driven fetches. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (inboxIsFetching) return;
                  setIsManuallyRefreshing(true);
                  markExternalEmailRefresh();
                  void queryClient.invalidateQueries({
                    queryKey: ["emails"],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: LABELS_QUERY_KEY,
                  });
                  void invalidateInboxThreads(queryClient);
                  window.setTimeout(() => setIsManuallyRefreshing(false), 800);
                }}
                disabled={inboxIsFetching}
                className={cn(
                  "flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                )}
                aria-label={t("mail.toolbar.refreshInbox")}
              >
                <IconRefresh
                  className={cn(
                    "h-4 w-4",
                    isManuallyRefreshing && "animate-spin",
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.toolbar.refreshInbox")}</TooltipContent>
          </Tooltip>

          {/* Compose — prominent outline button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleCompose}
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-3 text-[13px] sm:h-7"
                aria-label={t("mail.toolbar.composeEmail")}
              >
                <span>{t("mail.toolbar.compose")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.toolbar.composeShortcut")}</TooltipContent>
          </Tooltip>

          {/* Account avatars — overlapping stack */}
          {googleStatus.isLoading && (
            <div className="flex items-center ms-1">
              <Skeleton className="h-7 w-7 rounded-full ring-1 ring-card" />
            </div>
          )}
          {googleStatusReady && hasAccounts && (
            <Popover
              open={accountPopoverOpen}
              onOpenChange={setAccountPopoverOpen}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("mail.toolbar.accounts")}
                      className="flex shrink-0 items-center hover:opacity-90 transition-opacity ms-1"
                    >
                      <div
                        className="flex items-center"
                        style={{
                          marginRight: accounts.length > 1 ? 0 : undefined,
                        }}
                      >
                        {accounts.map((account, i) => {
                          const isActive =
                            activeAccounts.size === 0 ||
                            activeAccounts.has(account.email);
                          return (
                            <div
                              key={account.email}
                              className={cn(
                                "relative rounded-full ring-1 ring-card transition-opacity",
                                !isActive && "opacity-30",
                              )}
                              style={{
                                marginLeft: i === 0 ? 0 : -8,
                                zIndex: accounts.length - i,
                              }}
                            >
                              <AccountAvatar
                                email={account.email}
                                photoUrl={account.photoUrl}
                                imageClassName="h-7 w-7 rounded-full object-cover"
                                fallbackClassName="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-semibold text-primary"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("mail.toolbar.accounts")}</TooltipContent>
              </Tooltip>
              <PopoverContent
                align="end"
                className="w-72 max-w-[calc(100vw-2rem)] p-0"
              >
                <AccountPopover
                  accounts={accounts}
                  canAddAccount={googleConfigured || canOfferGoogleOAuthSetup}
                  activeAccounts={activeAccounts}
                  onToggleAccount={(email) => {
                    setActiveAccounts((prev) => {
                      const next = new Set(prev);
                      if (next.size === 0) {
                        for (const a of accounts) {
                          if (a.email !== email) next.add(a.email);
                        }
                      } else if (next.has(email)) {
                        next.delete(email);
                        if (next.size === 0) return new Set();
                      } else {
                        next.add(email);
                        if (next.size === accounts.length) return new Set();
                      }
                      return next;
                    });
                  }}
                  onRemoveAccount={(email) => {
                    setActiveAccounts((prev) => {
                      const next = new Set(prev);
                      next.delete(email);
                      return next;
                    });
                  }}
                />
              </PopoverContent>
            </Popover>
          )}

          <NotificationsBell browserNotifications />
          <AgentToggleButton />
        </header>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            !isMobile && (sidebarOpen || sidebarPinned) && "ps-[260px]",
          )}
        >
          <InvitationBanner />

          {/* Compact, non-blocking — reuses the existing account-strip
              reconnect UI instead of a second banner system. */}
          {needsReauthAccount && <GoogleConnectBanner variant="banner" />}

          {/* Show full-page takeover when no accounts connected (except on
              settings page, or on an unknown route — an unmatched path must
              still reach the routed NotFound content, not this gate). */}
          {!googleStatus.isLoading &&
          !googleStatus.isError &&
          !hasAccounts &&
          !hasLocalMailboxData &&
          view !== "settings" &&
          view !== "draft-queue" &&
          isKnownMailView(view) &&
          (googleConfigured || canOfferGoogleOAuthSetup) ? (
            <GoogleConnectBanner variant="hero" />
          ) : (
            <main className="agent-native-app-main flex flex-1 overflow-hidden">
              {children}
            </main>
          )}
        </div>
      </div>
      {(() => {
        const popoutDrafts = compose.drafts.filter((d) => !d.inline);
        if (popoutDrafts.length === 0) return null;
        const popoutActiveId =
          compose.activeId &&
          popoutDrafts.some((d) => d.id === compose.activeId)
            ? compose.activeId
            : popoutDrafts[popoutDrafts.length - 1].id;
        const popoutActiveDraft =
          popoutDrafts.find((d) => d.id === popoutActiveId) ?? null;
        return (
          <Suspense fallback={null}>
            <ComposeModal
              drafts={popoutDrafts}
              activeId={popoutActiveId}
              activeDraft={popoutActiveDraft}
              initialExpanded={composeInitialExpanded}
              onSetActiveId={compose.setActiveId}
              onUpdate={compose.update}
              onClose={(id) => {
                const draft = popoutDrafts.find((d) => d.id === id);
                const hasContent = !!(
                  draft?.to?.trim() ||
                  draft?.cc?.trim() ||
                  draft?.bcc?.trim() ||
                  draft?.subject?.trim() ||
                  draft?.body?.trim()
                );
                const snapshot = draft ? { ...draft } : null;
                const savePromise = compose.close(id);
                if (hasContent && snapshot) {
                  toast(t("mail.toasts.draftClosed"), {
                    action: {
                      label: t("mail.compose.reopenDraft"),
                      onClick: async () => {
                        const savedSnapshot = applyDraftSaveResult(
                          snapshot,
                          await savePromise,
                        );
                        const { id: _id, ...reopenData } = savedSnapshot;
                        compose.open(reopenData);
                      },
                    },
                    cancel: {
                      label: t("mail.compose.deleteDraft"),
                      onClick: async () => {
                        const savedSnapshot = applyDraftSaveResult(
                          snapshot,
                          await savePromise,
                        );
                        if (savedSnapshot.savedDraftId) {
                          await compose.deleteSavedDraft(savedSnapshot);
                        }
                      },
                    },
                  });
                }
              }}
              onCloseAll={() => {
                const draftsWithContent = popoutDrafts.filter(
                  (d) =>
                    !!(
                      d.to?.trim() ||
                      d.cc?.trim() ||
                      d.bcc?.trim() ||
                      d.subject?.trim() ||
                      d.body?.trim()
                    ),
                );
                const snapshots = draftsWithContent.map((d) => ({ ...d }));
                const savePromises = compose.closeAll(
                  popoutDrafts.map((draft) => draft.id),
                );
                if (snapshots.length > 0) {
                  toast(
                    t("mail.toasts.draftsClosed", { count: snapshots.length }),
                    {
                      action: {
                        label: t("mail.compose.reopenDraft"),
                        onClick: async () => {
                          const saveResults = await Promise.all(
                            snapshots.map(async (snapshot) => ({
                              snapshot,
                              result: await savePromises.get(snapshot.id),
                            })),
                          );
                          for (const { snapshot, result } of saveResults) {
                            if (
                              result?.status === "failed" ||
                              result?.status === "unavailable" ||
                              result?.status === "cancelled"
                            ) {
                              compose.setActiveId(snapshot.id);
                              continue;
                            }
                            const savedSnapshot = applyDraftSaveResult(
                              snapshot,
                              result,
                            );
                            const { id: _id, ...reopenData } = savedSnapshot;
                            compose.open(reopenData);
                          }
                        },
                      },
                      cancel: {
                        label: t("mail.compose.deleteDrafts"),
                        onClick: async () => {
                          const saveResults = await Promise.all(
                            snapshots.map(async (snapshot) => ({
                              snapshot,
                              result: await savePromises.get(snapshot.id),
                            })),
                          );
                          for (const { snapshot, result } of saveResults) {
                            if (
                              result?.status === "failed" ||
                              result?.status === "unavailable" ||
                              result?.status === "cancelled"
                            ) {
                              compose.discard(snapshot.id);
                              continue;
                            }
                            const savedSnapshot = applyDraftSaveResult(
                              snapshot,
                              result,
                            );
                            if (savedSnapshot.savedDraftId) {
                              await compose.deleteSavedDraft(savedSnapshot);
                            }
                          }
                        },
                      },
                    },
                  );
                }
              }}
              onDiscard={compose.discard}
              onStageForSend={compose.stageForSend}
              onRestoreAfterSend={compose.restoreAfterSend}
              onNewDraft={handleCompose}
              onFlush={compose.flush}
              onInitialExpandedConsumed={clearComposeInitialExpanded}
              onRegisterComposeCommands={registerComposePaletteCommands}
            />
          </Suspense>
        );
      })()}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={handlePaletteOpenChange}
        onCloseAutoFocus={restorePaletteFocus}
        onCompose={handleCompose}
        onSearch={() => document.getElementById("mail-search")?.focus()}
        onSnooze={targetEmail ? handleSnooze : undefined}
        onSpam={handleSpam}
        onBlockSender={handleBlockSender}
        onMuteThread={handleMuteThread}
        hasEmail={!!targetEmail}
        isComposeContext={paletteOpenedFromCompose}
        onSend={
          paletteOpenedFromCompose && composeCommandsAvailable
            ? sendComposeFromCommandPalette
            : undefined
        }
        onSendLater={
          paletteOpenedFromCompose && composeCommandsAvailable
            ? scheduleComposeFromCommandPalette
            : undefined
        }
        onSendAndMarkDone={
          paletteOpenedFromCompose && composeCommandsAvailable
            ? sendAndMarkDoneFromCommandPalette
            : undefined
        }
      />
      <SnoozeModal
        open={snoozeOpen}
        emailId={snoozeOverride?.targets[0]?.emailId ?? targetEmail?.id ?? null}
        accountEmail={
          snoozeOverride?.targets[0]?.accountEmail ?? targetEmail?.accountEmail
        }
        targets={
          snoozeOverride?.targets ??
          (targetEmail
            ? [
                {
                  emailId: targetEmail.id,
                  accountEmail: targetEmail.accountEmail,
                },
              ]
            : undefined)
        }
        onClose={() => {
          setSnoozeOpen(false);
          setSnoozeOverride(null);
        }}
        onSnoozed={() => {
          setSnoozeOpen(false);
          setSnoozeOverride(null);
        }}
      />
      <AiInboxSetup />
    </AccountFilterContext.Provider>
  );
}

function StandardLayout({ children }: AppLayoutProps) {
  const t = useT();
  const location = useLocation();
  const isAgentChatRoute = location.pathname === "/chat";
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const headerTitle = useHeaderTitle();
  const headerActions = useHeaderActions();
  const queuedDrafts = useQueuedDraftCount();
  const view = location.pathname.split("/").filter(Boolean)[0] || "";

  const collapseButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label={t("sidebar.collapseSidebar")}
        >
          <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  );
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setSidebarOpen(false);
            window.setTimeout(
              () => document.getElementById("mail-search")?.focus(),
              0,
            );
          }}
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label={t("mail.search.label")}
        >
          <IconSearch className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{t("mail.search.label")}</TooltipContent>
    </Tooltip>
  );
  const feedbackButton = <FeedbackButton variant="sidebar" side="right" />;

  const pageOwnsToolbar =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");

  const fallbackTitle = (() => {
    if (location.pathname === "/agent") return t("settings.agentTitle");
    if (location.pathname === "/team") return t("mail.pages.team");
    if (location.pathname.startsWith("/draft-queue"))
      return t("mail.views.draftQueue");
    if (location.pathname.startsWith("/extensions"))
      return t("mail.views.extensions");
    return t("mail.appName");
  })();

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-background">
      {!pageOwnsToolbar && (
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0 cursor-pointer"
                aria-label={t("mail.toolbar.toggleMenu")}
              >
                <IconMenu2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.toolbar.menu")}</TooltipContent>
          </Tooltip>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {headerTitle ?? (
              <h1 className="text-lg font-semibold tracking-tight truncate">
                {fallbackTitle}
              </h1>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            {!isAgentChatRoute && <AgentToggleButton />}
          </div>
        </header>
      )}

      <>
        <div
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-30 bg-[var(--mail-overlay-scrim)] transition-opacity duration-200 ease-out motion-reduce:transition-none",
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
          className={cn(
            "fixed start-0 top-0 bottom-0 z-40 flex w-[260px] flex-col overflow-hidden border-e border-border bg-sidebar transition-transform duration-200 ease-out motion-reduce:transition-none",
            sidebarOpen
              ? "translate-x-0"
              : "pointer-events-none -translate-x-full rtl:translate-x-full",
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <Link
              to="/inbox"
              onClick={() => setSidebarOpen(false)}
              className="flex min-w-0 items-center gap-2 rounded text-start outline-none"
            >
              <AgentNativeIcon
                aria-hidden="true"
                className="h-3.5 w-6 shrink-0 text-primary"
              />
              <span className="truncate text-sm font-semibold text-primary">
                {t("mail.appName")}
              </span>
            </Link>
            <EnvironmentBadge placement="inline" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <div className="space-y-0.5">
              {[
                { id: "inbox", label: t("mail.views.inbox"), href: "/inbox" },
                {
                  id: "unread",
                  label: t("mail.views.unread"),
                  href: "/unread",
                },
                {
                  id: "starred",
                  label: t("mail.views.starred"),
                  href: "/starred",
                },
                {
                  id: "snoozed",
                  label: t("mail.views.snoozed"),
                  href: "/snoozed",
                },
                { id: "sent", label: t("mail.views.sent"), href: "/sent" },
                {
                  id: "draft-queue",
                  label: t("mail.views.draftQueue"),
                  href: "/draft-queue",
                },
                {
                  id: "scheduled",
                  label: t("mail.views.scheduled"),
                  href: "/scheduled",
                },
                {
                  id: "drafts",
                  label: t("mail.views.drafts"),
                  href: "/drafts",
                },
                {
                  id: "archive",
                  label: t("mail.views.archive"),
                  href: "/archive",
                },
                { id: "trash", label: t("mail.views.trash"), href: "/trash" },
              ].map((item) => (
                <Link
                  key={item.id}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                    view === item.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-primary hover:bg-accent/60",
                  )}
                >
                  <span>{item.label}</span>
                  {item.id === "draft-queue" && queuedDrafts.count > 0 && (
                    <span className="text-[12px] text-amber-300 tabular-nums">
                      {queuedDrafts.count}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <BuilderCreditNotice className="mx-2 mb-2 shrink-0" />
          <div className="shrink-0 border-t border-border p-2 space-y-1.5">
            <SidebarFooterActions
              feedback={feedbackButton}
              search={searchButton}
              collapse={collapseButton}
            />
            <div
              data-sidebar-footer-utilities
              className="flex items-center gap-0.5"
            >
              <OrgSwitcher
                hideBuilderCreditNotice
                className="min-w-0 flex-1 !bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary"
              />
              <DevDatabaseLink />
              <ThemeToggle className="size-9 shrink-0 !bg-transparent text-primary hover:!bg-accent/60 hover:!text-primary" />
            </div>
          </div>
        </div>
      </>

      <InvitationBanner />

      <main
        className={cn(
          "min-h-0 flex-1 overflow-hidden transition-[padding] duration-200 ease-out",
          !isMobile && sidebarOpen && "ps-[260px]",
        )}
      >
        {children}
      </main>
    </div>
  );
}

function CheckboxRow({
  checked,
  label,
  color,
  indent = 0,
  onToggle,
}: {
  checked: boolean;
  label: string;
  color?: string;
  indent?: number;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={indent ? { paddingInlineStart: 12 + indent } : undefined}
      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-start hover:bg-accent/50 transition-colors"
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-primary bg-primary" : "border-border/60",
        )}
      >
        {checked && (
          <IconCheck className="h-2.5 w-2.5 text-primary-foreground" />
        )}
      </span>
      <span className="flex items-center gap-1.5 text-[13px] text-foreground/80">
        {color && (
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        {label}
      </span>
    </button>
  );
}

function TabSettingsPopover({
  systemViews,
  aiTags,
  labels,
  userLabels,
  labelDisplayNames,
  pinnedLabels,
  combinedInbox,
  showSplitInbox,
  allTabVisible,
  savedFilters,
  labelAliases,
  search,
  onSearchChange,
  onToggle,
  onAllTabChange,
  onCombinedInboxChange,
  onRemoveFilter,
  onRename,
}: {
  systemViews: { id: string; labelKey: string }[];
  aiTags: { id: string; name: string }[];
  labels: Label[];
  userLabels: Label[];
  labelDisplayNames: ReadonlyMap<string, string>;
  pinnedLabels: string[];
  combinedInbox: boolean;
  showSplitInbox: boolean;
  allTabVisible: boolean;
  savedFilters: SavedMailFilter[];
  labelAliases: Record<string, string>;
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: string) => void;
  onAllTabChange: (checked: boolean) => void;
  onCombinedInboxChange: (checked: boolean) => void;
  onRemoveFilter: (id: string) => void;
  onRename: (id: string, alias: string) => void;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const searchEnabled =
    systemViews.length +
      aiTags.length +
      userLabels.length +
      savedFilters.length >
    10;
  const q = searchEnabled ? search.toLowerCase() : "";

  const filteredViews = search
    ? systemViews.filter((v) => t(v.labelKey).toLowerCase().includes(q))
    : systemViews;
  const filteredAiTags = search
    ? aiTags.filter((tag) => tag.name.toLowerCase().includes(q))
    : aiTags;
  const filteredSavedFilters = search
    ? savedFilters.filter(
        (filter) =>
          filter.name.toLowerCase().includes(q) ||
          filter.query.toLowerCase().includes(q),
      )
    : savedFilters;

  const gmailCategoryIds = new Set([
    "note-to-self",
    "promotions",
    "social",
    "updates",
    "forums",
    "personal",
  ]);
  const knownCategories: Label[] = [
    {
      id: "note-to-self",
      name: t("mail.views.noteToSelf"),
      type: "system",
      unreadCount: 0,
    },
    { id: "promotions", name: "Promotions", type: "system", unreadCount: 0 },
    { id: "social", name: "Social", type: "system", unreadCount: 0 },
    { id: "updates", name: "Updates", type: "system", unreadCount: 0 },
    { id: "forums", name: "Forums", type: "system", unreadCount: 0 },
  ];
  const apiCategories = userLabels.filter((l) => gmailCategoryIds.has(l.id));
  const apiCategoryIds = new Set(apiCategories.map((l) => l.id));
  const mergedCategories = [
    ...apiCategories,
    ...knownCategories.filter((c) => !apiCategoryIds.has(c.id)),
  ];
  const allLabels = search
    ? userLabels.filter((l) => l.name.toLowerCase().includes(q))
    : userLabels;
  const filteredCategories = search
    ? mergedCategories.filter((l) => l.name.toLowerCase().includes(q))
    : mergedCategories;
  const filteredLabels = allLabels.filter((l) => !gmailCategoryIds.has(l.id));

  const labelRows = labelTreeRows(filteredLabels);

  const showViews = filteredViews.length > 0;
  const showAiTags = filteredAiTags.length > 0;
  const showSavedFilters = filteredSavedFilters.length > 0;
  const showCategories = filteredCategories.length > 0;
  const showLabels = labelRows.length > 0;
  const noResults =
    !showAiTags &&
    !showViews &&
    !showSavedFilters &&
    !showCategories &&
    !showLabels &&
    search;

  return (
    <>
      {searchEnabled && (
        <div className="px-2 py-1.5 border-b border-border/30">
          <input
            autoFocus
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("mail.search.placeholder")}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none px-1 py-0.5"
          />
        </div>
      )}

      <div
        className={cn(combinedInbox && "opacity-40")}
        aria-disabled={combinedInbox}
        inert={combinedInbox}
      >
        <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
          <label
            htmlFor="all-inbox-tab-toggle"
            className="text-[13px] text-foreground"
          >
            {t("mail.tabSettings.allTab")}
          </label>
          <Switch
            id="all-inbox-tab-toggle"
            checked={allTabVisible}
            onCheckedChange={onAllTabChange}
          />
        </div>

        <div className="max-h-72 overflow-y-auto">
          {noResults && (
            <p className="px-3 py-3 text-[12px] text-muted-foreground/50">
              {t("mail.search.noMatches")}
            </p>
          )}

          {/* AI rule tags stay separate from the Gmail label tree. */}
          {showAiTags && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t("mail.aiFilter.aiTagsTitle")}
              </p>
              {filteredAiTags.map((tag) => (
                <CheckboxRow
                  key={tag.id}
                  checked={pinnedLabels.includes(tag.id)}
                  label={labelAliases[tag.id]?.trim() || tag.name}
                  color={labels.find((label) => label.id === tag.id)?.color}
                  onToggle={() => onToggle(tag.id)}
                />
              ))}
            </div>
          )}

          {/* System views */}
          {showViews && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t("mail.tabSettings.views")}
              </p>
              {filteredViews.map((v) => (
                <CheckboxRow
                  key={v.id}
                  checked={pinnedLabels.includes(v.id)}
                  label={t(v.labelKey)}
                  onToggle={() => onToggle(v.id)}
                />
              ))}
            </div>
          )}

          {/* Query-backed tabs saved from the search bar */}
          {showSavedFilters && (
            <div>
              <p
                className={cn(
                  "px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider",
                  showViews && "border-t border-border/20 mt-1",
                )}
              >
                {t("mail.tabSettings.savedFilters")}
              </p>
              {filteredSavedFilters.map((filter) => (
                <CheckboxRow
                  key={filter.id}
                  checked
                  label={filter.name}
                  onToggle={() => onRemoveFilter(filter.id)}
                />
              ))}
            </div>
          )}

          {/* Gmail categories */}
          {showCategories && (
            <div>
              <p
                className={cn(
                  "px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider",
                  showViews && "border-t border-border/20 mt-1",
                )}
              >
                {t("mail.tabSettings.categories")}
              </p>
              {filteredCategories.map((cat) => (
                <CheckboxRow
                  key={cat.id}
                  checked={pinnedLabels.includes(cat.id)}
                  label={cat.name}
                  onToggle={() => onToggle(cat.id)}
                />
              ))}
            </div>
          )}

          {/* User labels */}
          {showLabels && (
            <div>
              <p
                className={cn(
                  "px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider",
                  (showViews || showCategories) &&
                    "border-t border-border/20 mt-1",
                )}
              >
                {t("mail.views.labels")}
              </p>
              {labelRows.map(({ label, depth, displayName: leafName }) => {
                const isPinned = pinnedLabels.includes(label.id);
                const isEditing = editingId === label.id;
                const alias = labelAliases[label.id];
                const displayName =
                  alias || labelDisplayNames.get(label.id) || leafName;

                return (
                  <div key={label.id} className="group flex items-center">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 px-3 py-1"
                          style={
                            depth
                              ? { paddingInlineStart: 12 + depth * 12 }
                              : undefined
                          }
                        >
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onRename(label.id, editValue.trim());
                                setEditingId(null);
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => {
                              onRename(label.id, editValue.trim());
                              setEditingId(null);
                            }}
                            className="flex-1 bg-transparent text-[13px] text-foreground outline-none border-b border-primary/50 px-0 py-0.5"
                            placeholder={
                              labelDisplayNames.get(label.id) || leafName
                            }
                          />
                        </div>
                      ) : (
                        <CheckboxRow
                          checked={isPinned}
                          label={displayName}
                          color={label.color}
                          indent={depth * 12}
                          onToggle={() => onToggle(label.id)}
                        />
                      )}
                    </div>
                    {isPinned && !isEditing && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              setEditingId(label.id);
                              setEditValue(alias || "");
                            }}
                            className="shrink-0 me-2 px-1 py-0.5 text-[10px] text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 rounded hover:bg-accent/50"
                          >
                            {t("mail.tabSettings.rename")}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("mail.tabSettings.renameTab")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showSplitInbox && (
        <div className="flex items-center justify-between border-t border-border/30 px-3 py-2">
          <label
            htmlFor="split-inbox-toggle"
            className="text-[13px] text-foreground"
          >
            {t("mail.tabSettings.splitInbox")}
          </label>
          <Switch
            id="split-inbox-toggle"
            checked={!combinedInbox}
            onCheckedChange={(checked) => onCombinedInboxChange(!checked)}
          />
        </div>
      )}
    </>
  );
}

function AccountPopover({
  accounts,
  canAddAccount,
  activeAccounts,
  onToggleAccount,
  onRemoveAccount,
}: {
  accounts: Array<{
    email: string;
    displayName?: string;
    photoUrl?: string;
    shared?: boolean;
  }>;
  canAddAccount: boolean;
  activeAccounts: Set<string>;
  onToggleAccount: (email: string) => void;
  onRemoveAccount: (email: string) => void;
}) {
  const t = useT();
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const disconnectGoogle = useDisconnectGoogle();

  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    setWantAuthUrl(false);
    window.open(authUrl.data.url, "_blank");

    let inFlight = false;
    const interval = setInterval(async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const abortTimer = setTimeout(
        () => controller.abort(),
        ACCOUNT_POLL_ABORT_MS,
      );
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/google/status"),
          { signal: controller.signal },
        )
          // coercion-ok: a failed probe and a not-yet-added-account response
          // both mean "keep waiting"; this loop only acts on an observed
          // account-count increase.
          .catch(() => null);
        if (res?.ok) {
          const data = await res.json();
          if (data.accounts?.length > accounts.length) {
            clearInterval(interval);
            window.location.reload();
          }
        }
      } finally {
        clearTimeout(abortTimer);
        inFlight = false;
      }
    }, ACCOUNT_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [wantAuthUrl, authUrl.data, accounts.length]);

  const allSelected = activeAccounts.size === 0;

  return (
    <>
      <div className="px-3 py-2 border-b border-border/30">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {t("mail.toolbar.accounts")}
        </p>
      </div>

      <div className="py-1">
        {accounts.map((account) => {
          const isChecked = allSelected || activeAccounts.has(account.email);
          return (
            <div
              key={account.email}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors group"
            >
              {/* Checkbox */}
              <button
                type="button"
                aria-label={account.email}
                aria-pressed={isChecked}
                onClick={() => onToggleAccount(account.email)}
                className="shrink-0"
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors",
                    isChecked
                      ? "border-primary bg-primary"
                      : "border-border/60",
                  )}
                >
                  {isChecked && (
                    <IconCheck className="h-2.5 w-2.5 text-primary-foreground" />
                  )}
                </span>
              </button>
              <AccountAvatar
                email={account.email}
                photoUrl={account.photoUrl}
                imageClassName="h-6 w-6 rounded-full object-cover shrink-0"
                fallbackClassName="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-foreground/80">
                  {account.displayName || account.email}
                </span>
                {account.displayName &&
                  account.displayName !== account.email && (
                    <span className="truncate text-[11px] text-muted-foreground/60">
                      {account.email}
                    </span>
                  )}
              </span>
              {!account.shared && (
                <button
                  onClick={() => {
                    onRemoveAccount(account.email);
                    disconnectGoogle.mutate(account.email);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-destructive transition-all"
                >
                  {t("mail.accounts.remove")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {canAddAccount ? (
        <div className="border-t border-border/30 px-3 py-2">
          <button
            onClick={() => {
              const returnPath = `${window.location.pathname}${window.location.search}`;
              startWorkspaceProviderOAuth("gmail", {
                appId: "mail",
                returnPath,
                scope: "user",
              });
            }}
            disabled={authUrl.isLoading || authUrl.isFetching}
            className="flex items-center gap-2 w-full text-[13px] text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <IconPlus className="h-3.5 w-3.5" />
            {authUrl.isFetching
              ? t("mail.accounts.connecting")
              : t("mail.accounts.addAccount")}
          </button>
        </div>
      ) : null}
    </>
  );
}
