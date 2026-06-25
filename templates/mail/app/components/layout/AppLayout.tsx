import {
  AgentSidebar,
  AgentToggleButton,
  DevDatabaseLink,
  FeedbackButton,
  NotificationsBell,
  agentNativePath,
  useT,
} from "@agent-native/core/client";
import { appApiPath } from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { InvitationBanner, OrgSwitcher } from "@agent-native/core/client/org";
import { normalizeMailLabel } from "@shared/gmail-labels";
import type { Label } from "@shared/types";
import {
  IconMenu2,
  IconSettings,
  IconSearch,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconPin,
  IconPinnedFilled,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router";
import { toast } from "sonner";

import { ComposeModal } from "@/components/email/ComposeModal";
import { SnoozeModal } from "@/components/email/SnoozeModal";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AccountFilterContext } from "@/hooks/use-account-filter";
import { useComposeState } from "@/hooks/use-compose-state";
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
} from "@/hooks/use-emails";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import {
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { runUndo } from "@/hooks/use-undo";
import {
  qualifiesForInboxTab,
  pinnedTriageLabels,
  augmentSelfSentLabels,
} from "@/lib/inbox-tabs";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./CommandPalette";
import { useHeaderTitle, useHeaderActions } from "./HeaderActions";
import { SearchBar } from "./SearchBar";

const BARE_ROUTES = new Set(["/email"]);

type SnoozeTarget = {
  emailId: string;
  accountEmail?: string;
};
const COMPOSE_FULLSCREEN_PARAM = "composeFullscreen";

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

/**
 * Routes that render the slim "standard layout" chrome instead of the full
 * inbox chrome (tabs, search bar, account stack, compose pen, draft queue
 * badge button, theme toggle, etc.). These pages have their own internal
 * toolbars and only need a generic h-12 header with the page title + the
 * AgentToggleButton.
 */
function isStandardLayoutPath(pathname: string): boolean {
  return (
    pathname === "/settings" ||
    pathname === "/team" ||
    pathname === "/draft-queue" ||
    pathname.startsWith("/draft-queue/") ||
    pathname === "/extensions" ||
    pathname.startsWith("/extensions/")
  );
}

/** Extract the trailing segment of a nested label name, e.g. "[Superhuman]/AI/Pitch" → "Pitch" */
function shortLabelName(name: string): string {
  const lastSlash = name.lastIndexOf("/");
  if (lastSlash >= 0) return name.slice(lastSlash + 1).replace(/_/g, " ");
  return name;
}

function labelDepth(name: string): number {
  return Math.max(0, name.split("/").length - 1);
}

interface AppLayoutProps {
  children: React.ReactNode;
}

// System views that can be shown/hidden via settings
const collapsibleViews = [
  { id: "unread", labelKey: "mail.views.unread" },
  { id: "starred", labelKey: "mail.views.starred" },
  { id: "sent", labelKey: "mail.views.sent" },
  { id: "drafts", labelKey: "mail.views.drafts" },
  { id: "archive", labelKey: "mail.views.archive" },
  { id: "trash", labelKey: "mail.views.trash" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const t = useT();
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const content = isStandardLayoutPath(location.pathname) ? (
    <StandardLayout>{children}</StandardLayout>
  ) : (
    <AppLayoutInner>{children}</AppLayoutInner>
  );

  return (
    <AgentSidebar
      position="right"
      defaultOpen={!isMobile}
      emptyStateText={t("agent.emptyState")}
      suggestions={[
        t("agent.suggestionSummarize"),
        t("agent.suggestionReplies"),
        t("agent.suggestionWidget"),
      ]}
    >
      {content}
    </AgentSidebar>
  );
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const compose = useComposeState();
  const headerActions = useHeaderActions();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // When the user requests snooze from the list, we need to snooze the live
  // focused/selected rows — not whatever is currently in navigation state.
  // This override wins over `targetEmail` while the modal is open.
  const [snoozeOverride, setSnoozeOverride] = useState<{
    targets: SnoozeTarget[];
  } | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  // Parse view and threadId from pathname since AppLayout is outside <Routes>
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const view = pathSegments[0] || "inbox";
  const threadId = pathSegments[1] || undefined;
  const queuedDrafts = useQueuedDraftCount();
  const [searchParams] = useSearchParams();
  const activeSearchQuery = searchParams.get("q");
  const activeLabel = searchParams.get("label");
  const composeInitialExpanded =
    searchParams.get(COMPOSE_FULLSCREEN_PARAM) === "1";
  const clearComposeInitialExpanded = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    if (!next.has(COMPOSE_FULLSCREEN_PARAM)) return;
    next.delete(COMPOSE_FULLSCREEN_PARAM);
    const search = next.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, navigate, searchParams]);
  // Remember which view (and label tab) the user was in before searching —
  // SearchBar always routes searches through /all?q=..., so on clear we'd
  // otherwise drop a user searching from Starred/Sent/Archive or from a
  // label-filtered tab back into plain Inbox.
  const preSearchViewRef = useRef<{ view: string; label: string | null }>({
    view,
    label: activeLabel,
  });
  useEffect(() => {
    if (!activeSearchQuery) {
      preSearchViewRef.current = { view, label: activeLabel };
    }
  }, [view, activeLabel, activeSearchQuery]);
  const restorePreSearchPath = useCallback(() => {
    const { view: v, label: l } = preSearchViewRef.current;
    return `/${v}${l ? `?label=${encodeURIComponent(l)}` : ""}`;
  }, []);
  // When the search param is cleared externally (browser back/forward,
  // agent navigation), drop the searchFocused flag — otherwise the bar
  // stays mounted with an empty input and no focus, since nothing fires
  // onBlur after the input was already blurred by a prior Enter.
  const prevSearchQueryRef = useRef(activeSearchQuery);
  useEffect(() => {
    if (prevSearchQueryRef.current && !activeSearchQuery) {
      setSearchFocused(false);
      setSearchQuery("");
    }
    prevSearchQueryRef.current = activeSearchQuery;
  }, [activeSearchQuery]);
  const { data: labels = [], isLoading: labelsLoading } = useLabels();
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const googleStatus = useGoogleAuthStatus();
  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;
  const googleStatusReady = !googleStatus.isLoading && !googleStatus.isError;
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  // Account filter: which accounts' emails to show. Empty set = all accounts.
  // Persisted to localStorage so it survives page refreshes.
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
  // Persist active accounts to localStorage
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
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  // Spin the refresh icon only when the user clicked the button — background
  // poll-driven `inboxIsFetching` should not animate the icon. Reset shortly
  // after click so the spin always feels like a deliberate action.
  const [isManuallyRefreshing, setIsManuallyRefreshing] = useState(false);

  const isGoogleConnected = (googleStatus.data?.accounts?.length ?? 0) > 0;
  const connectedEmails = useMemo(
    () => new Set(accounts.map((a) => a.email.toLowerCase())),
    [accounts],
  );
  // Important is always on and always first when Google is connected
  const userPinnedLabels = settings?.pinnedLabels ?? [];
  const pinnedLabels = isGoogleConnected
    ? ["important", ...userPinnedLabels.filter((id) => id !== "important")]
    : userPinnedLabels;
  const hasNoteToSelf = pinnedLabels.includes("note-to-self");
  const labelAliases = settings?.labelAliases ?? {};
  const {
    data: rawInboxEmails = [],
    isLoading: emailsLoading,
    isFetching: inboxIsFetching,
  } = useEmails("inbox");
  const { data: rawAllLocalEmails = [], isLoading: allLocalEmailsLoading } =
    useEmails("all", undefined, undefined, {
      enabled: googleStatusReady && !hasAccounts,
    });
  const hasLocalMailboxData =
    !hasAccounts &&
    (rawAllLocalEmails.length > 0 ||
      rawInboxEmails.length > 0 ||
      labels.some(
        (label) => (label.totalCount ?? 0) > 0 || (label.unreadCount ?? 0) > 0,
      ));
  // Augment emails: self-sent → "important" (or "note-to-self" if pinned)
  const inboxEmails = useMemo(
    () =>
      augmentSelfSentLabels(rawInboxEmails, {
        isGoogleConnected,
        connectedEmails,
        hasNoteToSelf,
      }),
    [rawInboxEmails, isGoogleConnected, connectedEmails, hasNoteToSelf],
  );
  const tabsLoading =
    labelsLoading || settingsLoading || emailsLoading || allLocalEmailsLoading;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("mail-sidebar-pinned") === "true";
  });
  useEffect(() => {
    if (sidebarPinned) localStorage.setItem("mail-sidebar-pinned", "true");
    else localStorage.removeItem("mail-sidebar-pinned");
  }, [sidebarPinned]);
  const showSidebar = sidebarOpen || (sidebarPinned && !isMobile);
  const closeSidebar = useCallback(() => {
    if (!sidebarPinned || isMobile) setSidebarOpen(false);
  }, [sidebarPinned, isMobile]);

  // Drag-to-reorder tabs
  const [dragPinnedId, setDragPinnedId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    tabIndex: number;
    side: "left" | "right";
  } | null>(null);

  // Compute local thread counts for virtual labels and local/demo mail. Gmail
  // system/user labels use server-provided counts when available.
  const labelThreadCounts = useMemo(() => {
    const unread: Record<string, number> = {};
    const total: Record<string, number> = {};
    // Filter emails by active accounts before counting
    const filtered =
      activeAccounts.size > 0
        ? inboxEmails.filter(
            (e) => e.accountEmail && activeAccounts.has(e.accountEmail),
          )
        : inboxEmails;
    // Find the latest message + unread state per thread.
    const threadState = new Map<
      string,
      { latest: (typeof filtered)[0]; hasUnread: boolean }
    >();
    for (const e of filtered) {
      const key = e.threadId || e.id;
      const existing = threadState.get(key);
      if (!existing) {
        threadState.set(key, { latest: e, hasUnread: !e.isRead });
      } else {
        existing.hasUnread ||= !e.isRead;
        if (new Date(e.date) > new Date(existing.latest.date)) {
          existing.latest = e;
        }
      }
    }
    const threadRows = [...threadState.values()];
    const triageLabels = pinnedTriageLabels(pinnedLabels);
    // "Other" = the inbox remainder. Shared with the rendered list
    // (InboxPage) via qualifiesForInboxTab so a tab's badge can never
    // disagree with the emails it actually shows.
    const inboxRows = threadRows.filter(({ latest }) =>
      qualifiesForInboxTab(latest.labelIds, null, triageLabels),
    );
    total["__inboxTotal"] = threadRows.length;
    unread["__inboxTotal"] = threadRows.filter(
      ({ hasUnread }) => hasUnread,
    ).length;
    total["inbox"] = inboxRows.length;
    unread["inbox"] = inboxRows.filter(({ hasUnread }) => hasUnread).length;
    // Count threads per pinned label using the exact same membership rule as
    // the rendered list: latest message has the label; "important" is
    // exclusive of any other pinned tab.
    for (let i = 0; i < pinnedLabels.length; i++) {
      const full = pinnedLabels[i];
      const rows = threadRows.filter(({ latest }) =>
        qualifiesForInboxTab(latest.labelIds, full, triageLabels),
      );
      total[full] = rows.length;
      unread[full] = rows.filter(({ hasUnread }) => hasUnread).length;
      // Also index by the canonical label.id (which uses spaces, not
      // underscores) so count lookups find it for nested labels.
      const canonical = labels.find(
        (l) =>
          l.id === full ||
          l.id === normalizeMailLabel(full) ||
          l.name.toLowerCase() === full.toLowerCase(),
      );
      if (canonical) {
        total[canonical.id] = total[full];
        unread[canonical.id] = unread[full];
      }
    }
    return { total, unread };
  }, [inboxEmails, pinnedLabels, activeAccounts, labels]);

  // Tabs to show in the bar: pinned triage filters first, then the inbox
  // remainder as "Other". Without pinned filters, the inbox is just "Inbox".
  const hasPinnedFilters = pinnedLabels.some(
    (id) => !collapsibleViews.some((v) => v.id === id),
  );

  const visibleTabs = useMemo(() => {
    const tabs: {
      id: string;
      pinnedId?: string;
      label: string;
      fullLabel?: string;
      href: string;
      isActive: boolean;
      color?: string;
      type: "system" | "label";
    }[] = [];

    if (!hasPinnedFilters) {
      tabs.push({
        id: "inbox",
        label: t("mail.views.inbox"),
        href: "/inbox",
        isActive: view === "inbox" && !activeLabel,
        type: "system",
      });
    }

    const seenLabels = new Set<string>(["inbox"]);
    for (const id of pinnedLabels) {
      // Check if it's a system view
      const sysView = collapsibleViews.find((v) => v.id === id);
      if (sysView) {
        if (seenLabels.has(sysView.id)) continue;
        seenLabels.add(sysView.id);
        tabs.push({
          id: sysView.id,
          pinnedId: id,
          label: t(sysView.labelKey),
          href: `/${sysView.id}`,
          isActive: view === sysView.id,
          type: "system",
        });
        continue;
      }
      // Check if it's a user label (handle old nested-path IDs like "[superhuman]/ai/pitch")
      const normalizedId = id.includes("/")
        ? id
            .slice(id.lastIndexOf("/") + 1)
            .replace(/_/g, " ")
            .toLowerCase()
        : id.toLowerCase();
      const lbl = labels.find(
        (l) =>
          l.id === normalizedId ||
          l.id === id ||
          l.name.toLowerCase() === id.toLowerCase(),
      );
      if (lbl) {
        const rawName = shortLabelName(lbl.name);
        const aliasedName = labelAliases[lbl.id] || labelAliases[id] || rawName;
        const displayKey = aliasedName.toLowerCase();
        if (seenLabels.has(displayKey)) continue;
        seenLabels.add(displayKey);
        tabs.push({
          id: lbl.id,
          pinnedId: id,
          label: aliasedName,
          fullLabel: lbl.name,
          href: `/inbox?label=${encodeURIComponent(lbl.id)}`,
          isActive: activeLabel === lbl.id,
          color: lbl.color,
          type: "label",
        });
      }
    }

    if (hasPinnedFilters) {
      tabs.push({
        id: "inbox",
        label: t("mail.views.other"),
        href: "/inbox",
        isActive: view === "inbox" && !activeLabel,
        type: "system",
      });
    }

    return tabs;
  }, [
    labels,
    pinnedLabels,
    labelAliases,
    view,
    activeLabel,
    hasPinnedFilters,
    t,
  ]);

  const topBarTabs = useMemo(() => {
    const tabs = [...visibleTabs];
    if (activeLabel && !tabs.some((tab) => tab.id === activeLabel)) {
      const active = labels.find((label) => label.id === activeLabel);
      if (active) {
        const aliasedName =
          labelAliases[active.id] || shortLabelName(active.name);
        tabs.push({
          id: active.id,
          label: aliasedName,
          fullLabel: active.name,
          href: `/inbox?label=${encodeURIComponent(active.id)}`,
          isActive: true,
          color: active.color,
          type: "label",
        });
      }
    }
    return tabs;
  }, [activeLabel, labels, labelAliases, visibleTabs]);

  // System views NOT pinned (go in the "more" dropdown)
  const hiddenViews = useMemo(
    () => collapsibleViews.filter((v) => !pinnedLabels.includes(v.id)),
    [pinnedLabels],
  );

  // Is current view one of the hidden ones? If so force-show it
  const currentInHidden = hiddenViews.some((v) => v.id === view);

  // User labels available for pinning
  const userLabels = useMemo(() => {
    const filtered = labels.filter(
      (l) => !["inbox", ...collapsibleViews.map((v) => v.id)].includes(l.id),
    );
    // Deduplicate by display name (different paths can have the same short name)
    const seen = new Set<string>();
    return filtered.filter((l) => {
      const key = l.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [labels]);

  const handleCompose = useCallback(() => {
    compose.open({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      mode: "compose",
    });
  }, [compose]);

  // Spam / block / mute actions (need current email context)
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
  const { data: currentViewEmails = [] } = useEmails(
    isMailboxView ? view : "inbox",
    undefined,
    undefined,
    { enabled: isMailboxView },
  );
  const reportSpam = useReportSpam();
  const blockSender = useBlockSender();
  const muteThread = useMuteThread();

  // Find the target email: from open thread, or the focused row in the list via navigation state
  const [focusedListId, setFocusedListId] = useState<string | null>(null);

  // Poll navigation.json for the focused email ID (synced by InboxPage)
  useEffect(() => {
    if (threadId) return; // thread view has its own context
    const fetchNav = async () => {
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/navigation"),
        );
        if (res.ok) {
          const nav = await res.json();
          if (nav?.focusedEmailId) setFocusedListId(nav.focusedEmailId);
        }
      } catch {}
    };
    fetchNav();
    // Re-check when palette opens
    if (paletteOpen) fetchNav();
  }, [threadId, paletteOpen]);

  const targetEmail = useMemo(() => {
    if (threadId) {
      return currentViewEmails.find((e) => (e.threadId || e.id) === threadId);
    }
    if (focusedListId) {
      const focused = currentViewEmails.find((e) => e.id === focusedListId);
      if (focused) return focused;
    }
    // Fall back to the first email in the list — if it's auto-focused in the
    // UI, or the synced id points at a row that has since disappeared, shortcuts
    // should still work.
    return currentViewEmails[0] ?? undefined;
  }, [threadId, focusedListId, currentViewEmails]);

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
    muteThread.mutate(tid);
    toast(t("mail.toasts.threadMuted"));
  }, [threadId, targetEmail, muteThread, dismissEmail, t]);

  const togglePinned = useCallback(
    (id: string) => {
      const current = settings?.pinnedLabels ?? [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      updateSettings.mutate({ pinnedLabels: next });
    },
    [settings?.pinnedLabels, updateSettings],
  );

  // Drag-to-reorder tab handlers
  const handleTabDragStart = useCallback(
    (e: React.DragEvent, pinnedId: string) => {
      setDragPinnedId(pinnedId);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleTabDragOver = useCallback(
    (e: React.DragEvent, tabIndex: number) => {
      if (!dragPinnedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      setDropIndicator({
        tabIndex,
        side: e.clientX < midX ? "left" : "right",
      });
    },
    [dragPinnedId],
  );

  const handleTabDrop = useCallback(() => {
    if (!dragPinnedId || !dropIndicator) return;
    const current = settings?.pinnedLabels ?? [];
    if (!current.includes(dragPinnedId)) return;

    const targetTab = visibleTabs[dropIndicator.tabIndex];
    if (!targetTab) return;

    const without = current.filter((id) => id !== dragPinnedId);
    let insertAt: number;

    if (targetTab.pinnedId === "important") {
      insertAt = 0;
    } else if (!targetTab.pinnedId) {
      insertAt = without.length;
    } else {
      const targetIdx = without.indexOf(targetTab.pinnedId);
      if (targetIdx < 0) {
        insertAt = without.length;
      } else {
        insertAt = dropIndicator.side === "left" ? targetIdx : targetIdx + 1;
      }
    }

    without.splice(insertAt, 0, dragPinnedId);
    updateSettings.mutate({ pinnedLabels: without });
    setDragPinnedId(null);
    setDropIndicator(null);
  }, [
    dragPinnedId,
    dropIndicator,
    settings?.pinnedLabels,
    visibleTabs,
    updateSettings,
  ]);

  const handleTabDragEnd = useCallback(() => {
    setDragPinnedId(null);
    setDropIndicator(null);
  }, []);

  // Global keyboard shortcuts
  const cycleTab = useCallback(
    (reverse?: boolean) => {
      if (visibleTabs.length < 2) return;
      const activeIdx = visibleTabs.findIndex((t) => t.isActive);
      const delta = reverse ? -1 : 1;
      const nextIdx =
        (activeIdx === -1 ? 0 : activeIdx + delta + visibleTabs.length) %
        visibleTabs.length;
      navigate(visibleTabs[nextIdx].href);
    },
    [visibleTabs, navigate],
  );

  const handleSnooze = useCallback(() => {
    const listSnoozeEvent = new CustomEvent("email:shortcut-snooze", {
      cancelable: true,
    });
    window.dispatchEvent(listSnoozeEvent);
    if (listSnoozeEvent.defaultPrevented) return;

    if (!targetEmail) {
      toast.error("No email selected.");
      return;
    }
    setSnoozeOverride(null);
    setSnoozeOpen(true);
  }, [targetEmail]);

  // List snooze requests carry the current focused/selected rows. Swipe
  // requests still carry one target; keyboard and command-palette requests may
  // carry many.
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
      handler: () => setPaletteOpen(true),
      skipInInput: false,
    },
    {
      key: "/",
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
      handler: () => cycleTab(false),
    },
    {
      key: "Tab",
      shift: true,
      handler: () => cycleTab(true),
    },
    {
      key: "Escape",
      handler: () => {
        setSearchQuery("");
        setSearchFocused(false);
        (document.getElementById("mail-search") as HTMLInputElement)?.blur();
        if (activeSearchQuery) {
          navigate(restorePreSearchPath());
        }
      },
    },
  ]);

  // Sequence shortcuts (g + key = go to view)
  const qc = useQueryClient();
  useSequenceShortcuts([
    {
      keys: ["g", "i"],
      handler: () => {
        navigate("/inbox");
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
      },
    },
    { keys: ["g", "s"], handler: () => navigate("/starred") },
    { keys: ["g", "t"], handler: () => navigate("/sent") },
    { keys: ["g", "d"], handler: () => navigate("/drafts") },
    { keys: ["g", "a"], handler: () => navigate("/archive") },
    { keys: ["g", "e"], handler: () => navigate("/archive") },
    { keys: ["g", "#"], handler: () => navigate("/trash") },
  ]);

  const resolveLabelForCount = (id: string) => {
    const normalizedId = id.includes("/")
      ? id
          .slice(id.lastIndexOf("/") + 1)
          .replace(/_/g, " ")
          .toLowerCase()
      : id.toLowerCase();
    return labels.find(
      (label) =>
        label.id === id ||
        label.id === normalizedId ||
        label.name.toLowerCase() === id.toLowerCase(),
    );
  };

  const useServerLabelCounts = activeAccounts.size === 0;

  type CountKind = "unread" | "total";
  const countFieldForKind = (kind: CountKind) =>
    kind === "total" ? "totalCount" : "unreadCount";
  const localCountsForKind = (kind: CountKind) =>
    kind === "total" ? labelThreadCounts.total : labelThreadCounts.unread;

  // Take the larger of the server-reported count and the count we compute
  // locally from loaded inbox emails. Either side can be stale (Gmail label
  // totals can lag; loaded emails may be a partial window).
  const getInboxCount = (kind: CountKind) => {
    const inboxLabel = resolveLabelForCount("inbox");
    const countField = countFieldForKind(kind);
    const localCounts = localCountsForKind(kind);
    const serverCount = useServerLabelCounts
      ? (inboxLabel?.[countField] ?? 0)
      : 0;
    const localCount = localCounts["inbox"] ?? 0;
    return Math.max(serverCount, localCount);
  };

  const isExclusivePinnedTab = (viewId: string) => {
    if (!hasPinnedFilters) return false;
    // Pinned label rows (the ones that contribute to the "Other" remainder)
    // are exclusive: each inbox thread is counted in exactly one tab. Gmail's
    // server label counts don't have that exclusivity (e.g. server "important"
    // returns *all* important threads, regardless of whether they're also
    // categorized elsewhere), so we can't mix the two — use local only.
    return pinnedLabels.some((id) => {
      if (collapsibleViews.some((view) => view.id === id)) return false;
      const label = resolveLabelForCount(id);
      return (label?.id ?? id) === viewId || id === viewId;
    });
  };

  const getOtherCount = (kind: CountKind) => {
    if (!hasPinnedFilters) return getInboxCount(kind);
    const localCounts = localCountsForKind(kind);
    // Don't subtract pinned-label server counts from inbox server count:
    // Gmail's label totals include archived/sent/trash threads outside the
    // inbox, so the subtraction can drop "Other" to zero or undercount. The
    // local count (computed from loaded inbox emails, filtered by pinned-tab
    // membership) is the authoritative "Other" number.
    return localCounts["inbox"] ?? 0;
  };

  const getTabCount = (viewId: string, kind: CountKind) => {
    if (viewId === "inbox") return getOtherCount(kind);
    const label = resolveLabelForCount(viewId);
    const countField = countFieldForKind(kind);
    const localCounts = localCountsForKind(kind);
    const localCount =
      localCounts[viewId] ?? (label ? (localCounts[label.id] ?? 0) : 0);
    // Exclusive pinned tabs (when hasPinnedFilters is on, a thread belongs to
    // exactly one tab) can't fall back to Gmail's non-exclusive server count
    // — that would over-report the badge relative to what the tab renders.
    if (isExclusivePinnedTab(viewId)) return localCount;
    const serverCount =
      useServerLabelCounts && viewId !== "note-to-self"
        ? (label?.[countField] ?? 0)
        : 0;
    return Math.max(serverCount, localCount);
  };
  const getTopBarCount = (viewId: string) => getTabCount(viewId, "total");
  const getUnreadCount = (viewId: string) => getTabCount(viewId, "unread");
  const inboxSidebarUnreadCount =
    labelThreadCounts.unread["__inboxTotal"] ??
    labelThreadCounts.unread["inbox"] ??
    0;

  const accountFilterValue = useMemo(
    () => ({ activeAccounts, allAccounts: accounts }),
    [activeAccounts, accounts],
  );

  return (
    <AccountFilterContext.Provider value={accountFilterValue}>
      <div className="relative flex flex-1 flex-col overflow-hidden bg-background">
        {/* Top nav bar */}
        <header className="relative z-20 flex h-12 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2 inbox-zero-header">
          {/* Hamburger menu */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
                aria-label={t("mail.toolbar.toggleMenu")}
              >
                <IconMenu2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.toolbar.menu")}</TooltipContent>
          </Tooltip>

          {/* Primary tabs stay mounted during search so navigation does not jump. */}
          <>
            {tabsLoading ? (
              <nav className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-4 rounded bg-muted animate-pulse"
                    style={{ width: `${48 + i * 12}px` }}
                  />
                ))}
              </nav>
            ) : (
              <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto hide-scrollbar">
                {topBarTabs.map((tab, idx) => {
                  const visibleIndex = visibleTabs.findIndex(
                    (item) => item.id === tab.id,
                  );
                  const tabIndex = visibleIndex >= 0 ? visibleIndex : idx;
                  const count = getTopBarCount(tab.id);
                  const isDragging = dragPinnedId === tab.pinnedId;
                  const canDrag =
                    !!tab.pinnedId && tab.pinnedId !== "important";
                  const showLeft =
                    dropIndicator?.tabIndex === tabIndex &&
                    dropIndicator.side === "left";
                  const showRight =
                    dropIndicator?.tabIndex === tabIndex &&
                    dropIndicator.side === "right";
                  return (
                    <div
                      key={tab.pinnedId || tab.id}
                      className="relative flex items-center"
                      onDragOver={(e) => handleTabDragOver(e, tabIndex)}
                      onDrop={handleTabDrop}
                    >
                      {showLeft && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-full z-10" />
                      )}
                      <Link
                        to={tab.href}
                        draggable={canDrag}
                        onDragStart={(e) =>
                          canDrag &&
                          tab.pinnedId &&
                          handleTabDragStart(e, tab.pinnedId)
                        }
                        onDragEnd={handleTabDragEnd}
                        className={cn(
                          "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[13px] select-none",
                          tab.isActive
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground font-medium hover:text-foreground/80",
                          isDragging && "opacity-40",
                          canDrag && "cursor-grab",
                        )}
                      >
                        {tab.color && (
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: tab.color }}
                          />
                        )}
                        {tab.label}
                        {count > 0 && (
                          <span
                            className={cn(
                              "text-[11px] tabular-nums",
                              tab.isActive
                                ? "text-foreground/60"
                                : "text-muted-foreground/70",
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                      {showRight && (
                        <div className="absolute right-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-full z-10" />
                      )}
                    </div>
                  );
                })}

                {/* If navigated to an unpinned view (e.g. via keyboard shortcut), show it */}
                {currentInHidden && (
                  <span className="flex items-center whitespace-nowrap px-2.5 py-1 text-[13px] text-foreground font-semibold">
                    {t(
                      collapsibleViews.find((v) => v.id === view)?.labelKey ??
                        "mail.views.inbox",
                    )}
                  </span>
                )}
              </nav>
            )}

            {/* Tab settings cog */}
            <div className={cn("relative", tabsLoading && "invisible")}>
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
                          "flex h-6 w-6 items-center justify-center rounded transition-colors",
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
                  <TabSettingsPopover
                    systemViews={collapsibleViews}
                    userLabels={userLabels}
                    pinnedLabels={pinnedLabels}
                    labelAliases={labelAliases}
                    search={labelSearch}
                    onSearchChange={setLabelSearch}
                    onToggle={togglePinned}
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

          <div className="flex-1" />

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
              onClose={() => {
                setSearchFocused(false);
                setSearchQuery("");
                if (activeSearchQuery) {
                  navigate(restorePreSearchPath());
                }
              }}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSearchFocused(true)}
                  className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
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
                  qc.invalidateQueries({ queryKey: ["emails"] });
                  qc.invalidateQueries({ queryKey: ["labels"] });
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

          <NotificationsBell />

          {/* Compose — prominent outline button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={handleCompose}
                variant="outline"
                size="sm"
                className="h-9 sm:h-7 px-3 text-[13px]"
                aria-label={t("mail.toolbar.composeEmail")}
              >
                <span>{t("mail.toolbar.compose")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.toolbar.composeShortcut")}</TooltipContent>
          </Tooltip>

          {/* Account avatars — overlapping stack like Figma */}
          {googleStatus.isLoading && (
            <div className="flex items-center ms-1">
              <Skeleton className="h-7 w-7 rounded-full ring-2 ring-card" />
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
                    <button className="flex items-center hover:opacity-90 transition-opacity ms-1">
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
                                "relative rounded-full ring-2 ring-card transition-opacity",
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
                  activeAccounts={activeAccounts}
                  onToggleAccount={(email) => {
                    setActiveAccounts((prev) => {
                      const next = new Set(prev);
                      if (next.size === 0) {
                        // Switching from "all" → deselect this one (keep others)
                        for (const a of accounts) {
                          if (a.email !== email) next.add(a.email);
                        }
                      } else if (next.has(email)) {
                        next.delete(email);
                        // If nothing left, reset to "all"
                        if (next.size === 0) return new Set();
                      } else {
                        next.add(email);
                        // If all are now checked, reset to "all" (empty set)
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

          <AgentToggleButton />
        </header>

        {/* Sidebar overlay / pinned rail */}
        {showSidebar && (
          <>
            {(!sidebarPinned || isMobile) && (
              <div
                className="fixed inset-0 z-30 bg-black/20"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            <div
              className={cn(
                "flex w-64 flex-col overflow-hidden bg-background/85 backdrop-blur-2xl border-e border-border/30 shadow-2xl",
                sidebarPinned && !isMobile
                  ? "absolute start-0 top-12 bottom-0 z-10"
                  : "fixed start-0 top-0 bottom-0 z-40",
              )}
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/20 px-4">
                <span className="text-[13px] font-medium text-foreground">
                  {t("mail.appName")}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarPinned((value) => !value);
                        setSidebarOpen(true);
                      }}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground",
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
              </div>
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
                              "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start transition-all",
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

                <div className="p-4">
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
                          "flex items-center justify-between rounded-md px-3 py-2.5 text-[14px] transition-colors min-h-[44px]",
                          view === item.id
                            ? "bg-accent/60 text-foreground font-medium"
                            : "text-foreground/70 hover:bg-accent/30",
                        )}
                      >
                        <span>{item.label}</span>
                        {item.id === "draft-queue" &&
                          queuedDrafts.count > 0 && (
                            <span className="text-[12px] text-amber-300 tabular-nums">
                              {queuedDrafts.count}
                            </span>
                          )}
                        {item.id === "inbox" && inboxSidebarUnreadCount > 0 && (
                          <span className="text-[12px] text-muted-foreground/50 tabular-nums">
                            {inboxSidebarUnreadCount}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>

                  {/* Pinned labels */}
                  {pinnedLabels.filter(
                    (l) => !collapsibleViews.some((v) => v.id === l),
                  ).length > 0 && (
                    <>
                      <h2 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mt-5 mb-3">
                        {t("mail.views.labels")}
                      </h2>
                      <div className="space-y-0.5">
                        {visibleTabs
                          .filter((t) => t.id !== "inbox" && t.type === "label")
                          .map((tab) => {
                            const count = getUnreadCount(tab.id);
                            const depth = labelDepth(
                              tab.fullLabel ?? tab.label,
                            );
                            return (
                              <Link
                                key={tab.id}
                                to={tab.href}
                                onClick={closeSidebar}
                                className={cn(
                                  "flex items-center justify-between rounded-md px-3 py-2.5 text-[14px] transition-colors min-h-[44px]",
                                  tab.isActive
                                    ? "bg-accent/60 text-foreground font-medium"
                                    : "text-foreground/70 hover:bg-accent/30",
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
                                    title={tab.fullLabel}
                                  >
                                    {shortLabelName(tab.fullLabel ?? tab.label)}
                                  </span>
                                </span>
                                {count > 0 && (
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

              <div className="shrink-0 border-t border-border/20">
                <div className="px-2 py-1">
                  <ExtensionsSidebarSection />
                </div>

                <div className="border-t border-border/20 px-3 py-2">
                  <OrgSwitcher />
                </div>

                <div className="flex items-center gap-1 border-t border-border/20 px-2 py-2">
                  <DevDatabaseLink />
                  <FeedbackButton className="min-w-0 flex-1" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        to="/settings"
                        onClick={closeSidebar}
                        aria-label={t("mail.toolbar.settings")}
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                          location.pathname === "/settings" &&
                            "bg-accent/60 text-foreground",
                        )}
                      >
                        <IconSettings className="h-4 w-4" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("mail.toolbar.settings")}
                    </TooltipContent>
                  </Tooltip>
                  <ThemeToggle className="h-8 w-8 shrink-0" />
                </div>
              </div>
            </div>
          </>
        )}

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            sidebarPinned && !isMobile && "ps-64",
          )}
        >
          <InvitationBanner />

          {/* Show full-page takeover when no accounts connected (except on settings page) */}
          {!googleStatus.isLoading &&
          !googleStatus.isError &&
          !hasAccounts &&
          !hasLocalMailboxData &&
          view !== "settings" &&
          view !== "draft-queue" ? (
            <GoogleConnectBanner variant="hero" />
          ) : (
            <main className="flex flex-1 overflow-hidden">{children}</main>
          )}
        </div>
      </div>

      {(() => {
        // Filter out inline drafts (rendered in thread view, not the popout composer)
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
                draft?.subject?.trim() ||
                draft?.body?.trim()
              );
              const snapshot = draft ? { ...draft } : null;
              compose.close(id);
              if (hasContent && snapshot) {
                toast("Draft saved.", {
                  action: {
                    label: "REOPEN",
                    onClick: () => {
                      const { id: _id, ...reopenData } = snapshot;
                      compose.open(reopenData);
                    },
                  },
                  cancel: {
                    label: "DELETE DRAFT",
                    onClick: () => {
                      if (snapshot.savedDraftId) {
                        fetch(
                          appApiPath(`/api/emails/${snapshot.savedDraftId}`),
                          {
                            method: "DELETE",
                          },
                        );
                      }
                    },
                  },
                });
              }
            }}
            onCloseAll={() => {
              const draftsWithContent = popoutDrafts.filter(
                (d) => !!(d.to?.trim() || d.subject?.trim() || d.body?.trim()),
              );
              const snapshots = draftsWithContent.map((d) => ({ ...d }));
              const ids = popoutDrafts.map((d) => d.id);
              ids.forEach((id) => compose.close(id));
              if (snapshots.length > 0) {
                toast(`${snapshots.length} draft(s) saved.`, {
                  action: {
                    label: "REOPEN",
                    onClick: () => {
                      for (const snap of snapshots) {
                        const { id: _id, ...reopenData } = snap;
                        compose.open(reopenData);
                      }
                    },
                  },
                  cancel: {
                    label: "DELETE DRAFTS",
                    onClick: () => {
                      for (const snap of snapshots) {
                        if (snap.savedDraftId) {
                          fetch(
                            appApiPath(`/api/emails/${snap.savedDraftId}`),
                            {
                              method: "DELETE",
                            },
                          );
                        }
                      }
                    },
                  },
                });
              }
            }}
            onDiscard={compose.discard}
            onNewDraft={handleCompose}
            onFlush={compose.flush}
            onReopen={compose.open}
            onInitialExpandedConsumed={clearComposeInitialExpanded}
          />
        );
      })()}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCompose={handleCompose}
        onSnooze={targetEmail ? handleSnooze : undefined}
        onSpam={handleSpam}
        onBlockSender={handleBlockSender}
        onMuteThread={handleMuteThread}
        hasEmail={!!targetEmail}
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
    </AccountFilterContext.Provider>
  );
}

// ─── Standard Layout (settings, team, tools, draft-queue) ────────────────────

/**
 * Slim chrome used on secondary pages. Renders a clean h-12 header (title +
 * AgentToggleButton + NotificationsBell) instead of the inbox-specific top bar
 * (tabs, search, account stack, compose pen, etc.).
 *
 * Pages can hoist a custom title or right-side actions via
 * `useSetPageTitle` / `useSetHeaderActions` from `./HeaderActions`.
 */
function StandardLayout({ children }: AppLayoutProps) {
  const t = useT();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const headerTitle = useHeaderTitle();
  const headerActions = useHeaderActions();
  const queuedDrafts = useQueuedDraftCount();
  const view = location.pathname.split("/").filter(Boolean)[0] || "";

  // Extensions (`/extensions` list and `/extensions/:id` viewer) render their own h-12
  // toolbar with NotificationsBell + AgentToggleButton inside the shared
  // ExtensionViewer / ExtensionsListPage components. Skip our header to avoid stacking.
  const pageOwnsToolbar =
    location.pathname === "/extensions" ||
    location.pathname.startsWith("/extensions/");

  const fallbackTitle = (() => {
    if (location.pathname === "/settings") return t("settings.title");
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
            <NotificationsBell />
            <AgentToggleButton />
          </div>
        </header>
      )}

      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed start-0 top-0 bottom-0 z-40 flex w-64 flex-col overflow-hidden bg-background/70 backdrop-blur-2xl border-e border-border/30 shadow-2xl">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                      "flex items-center justify-between rounded-md px-3 py-2.5 text-[14px] transition-colors min-h-[44px]",
                      view === item.id
                        ? "bg-accent/60 text-foreground font-medium"
                        : "text-foreground/70 hover:bg-accent/30",
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

            <div className="shrink-0 border-t border-border/20">
              <div className="px-2 py-1">
                <ExtensionsSidebarSection />
              </div>

              <div className="border-t border-border/20 px-3 py-2">
                <OrgSwitcher />
              </div>

              <div className="flex items-center gap-1 border-t border-border/20 px-2 py-2">
                <DevDatabaseLink />
                <FeedbackButton className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        to="/settings"
                        onClick={() => setSidebarOpen(false)}
                        aria-label={t("mail.toolbar.settings")}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                          location.pathname === "/settings" &&
                            "bg-accent/60 text-foreground",
                        )}
                      >
                        <IconSettings className="h-4 w-4" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("mail.toolbar.settings")}
                    </TooltipContent>
                  </Tooltip>
                  <ThemeToggle className="h-8 w-8 shrink-0" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <InvitationBanner />

      <main className="flex flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

// ─── Tab Settings Popover ────────────────────────────────────────────────────

function CheckboxRow({
  checked,
  label,
  color,
  onToggle,
}: {
  checked: boolean;
  label: string;
  color?: string;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
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
  userLabels,
  pinnedLabels,
  labelAliases,
  search,
  onSearchChange,
  onToggle,
  onRename,
}: {
  systemViews: { id: string; labelKey: string }[];
  userLabels: Label[];
  pinnedLabels: string[];
  labelAliases: Record<string, string>;
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, alias: string) => void;
}) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const q = search.toLowerCase();

  const filteredViews = search
    ? systemViews.filter((v) => t(v.labelKey).toLowerCase().includes(q))
    : systemViews;

  // Split labels into Gmail categories and regular user labels
  // "important" is excluded — it's always on and not toggleable
  const gmailCategoryIds = new Set([
    "note-to-self",
    "promotions",
    "social",
    "updates",
    "forums",
    "personal",
  ]);
  // Ensure all known Gmail categories always appear (some are virtual, not from API)
  const knownCategories: Label[] = [
    {
      id: "note-to-self",
      name: "Note to Self",
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

  // Sort: pinned first, then alphabetical
  const sortedLabels = [...filteredLabels].sort((a, b) => {
    const ap = pinnedLabels.includes(a.id) ? 0 : 1;
    const bp = pinnedLabels.includes(b.id) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });

  const showViews = filteredViews.length > 0;
  const showCategories = filteredCategories.length > 0;
  const showLabels = sortedLabels.length > 0;
  const noResults = !showViews && !showCategories && !showLabels && search;

  return (
    <>
      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border/30">
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("mail.search.placeholder")}
          className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none px-1 py-0.5"
        />
      </div>

      <div className="max-h-72 overflow-y-auto">
        {noResults && (
          <p className="px-3 py-3 text-[12px] text-muted-foreground/50">
            {t("mail.search.noMatches")}
          </p>
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
            {sortedLabels.map((label) => {
              const isPinned = pinnedLabels.includes(label.id);
              const isEditing = editingId === label.id;
              const alias = labelAliases[label.id];
              const displayName = alias || shortLabelName(label.name);

              return (
                <div key={label.id} className="group flex items-center">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-1 px-3 py-1">
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
                          placeholder={shortLabelName(label.name)}
                        />
                      </div>
                    ) : (
                      <CheckboxRow
                        checked={isPinned}
                        label={displayName}
                        color={label.color}
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

      <div className="px-3 py-1.5 border-t border-border/30">
        <p className="text-[11px] text-muted-foreground/40">
          {t("mail.tabSettings.help")}
        </p>
      </div>
    </>
  );
}

// ─── Account Popover ─────────────────────────────────────────────────────────

function AccountPopover({
  accounts,
  activeAccounts,
  onToggleAccount,
  onRemoveAccount,
}: {
  accounts: Array<{ email: string; displayName?: string; photoUrl?: string }>;
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

    const interval = setInterval(async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        if (data.accounts?.length > accounts.length) {
          clearInterval(interval);
          window.location.reload();
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [wantAuthUrl, authUrl.data, accounts.length]);

  // Empty activeAccounts means "all selected"
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
              <button
                onClick={() => {
                  onRemoveAccount(account.email);
                  disconnectGoogle.mutate(account.email);
                }}
                className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-red-400 transition-all"
              >
                {t("mail.accounts.remove")}
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/30 px-3 py-2">
        <button
          onClick={() => setWantAuthUrl(true)}
          disabled={authUrl.isLoading || authUrl.isFetching}
          className="flex items-center gap-2 w-full text-[13px] text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <IconPlus className="h-3.5 w-3.5" />
          {authUrl.isFetching
            ? t("mail.accounts.connecting")
            : t("mail.accounts.addAccount")}
        </button>
      </div>
    </>
  );
}
