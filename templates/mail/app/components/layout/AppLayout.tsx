import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ComposeModal } from "@/components/email/ComposeModal";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { runUndo } from "@/hooks/use-undo";
import {
  useLabels,
  useSettings,
  useUpdateSettings,
  useEmails,
  useContacts,
  useReportSpam,
  useBlockSender,
  useMuteThread,
} from "@/hooks/use-emails";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { SnoozeModal } from "@/components/email/SnoozeModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SearchBar } from "./SearchBar";
import {
  IconMenu2,
  IconSettings,
  IconSearch,
  IconPencil,
  IconCheck,
  IconPlus,
  IconTool,
} from "@tabler/icons-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  getCallbackOrigin,
  AgentSidebar,
  AgentToggleButton,
  FeedbackButton,
} from "@agent-native/core/client";
import { InvitationBanner, OrgSwitcher } from "@agent-native/core/client/org";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import type { Label } from "@shared/types";
import { toast } from "sonner";

import { AccountFilterContext } from "@/hooks/use-account-filter";
import { useIsMobile } from "@/hooks/use-mobile";

const BARE_ROUTES = new Set(["/email"]);

/** Extract the trailing segment of a nested label name, e.g. "[Superhuman]/AI/Pitch" → "Pitch" */
function shortLabelName(name: string): string {
  const lastSlash = name.lastIndexOf("/");
  if (lastSlash >= 0) return name.slice(lastSlash + 1).replace(/_/g, " ");
  return name;
}

interface AppLayoutProps {
  children: React.ReactNode;
}

// System views that can be shown/hidden via settings
const collapsibleViews = [
  { id: "starred", label: "Starred" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
  { id: "trash", label: "Trash" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  return <AppLayoutInner>{children}</AppLayoutInner>;
}

function AppLayoutInner({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const compose = useComposeState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // When the user swipes a row to snooze, we need to snooze that specific
  // email — not whatever is currently focused in navigation state. This
  // override wins over `targetEmail` while a swipe-triggered modal is open.
  const [snoozeOverride, setSnoozeOverride] = useState<{
    id: string;
    accountEmail?: string;
  } | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  // Parse view and threadId from pathname since AppLayout is outside <Routes>
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const view = pathSegments[0] || "inbox";
  const threadId = pathSegments[1] || undefined;
  const [searchParams] = useSearchParams();
  const activeSearchQuery = searchParams.get("q");
  const activeLabel = searchParams.get("label");
  // Remember which view (and label tab) the user was in before searching —
  // SearchBar always routes searches through /inbox?q=..., so on clear we'd
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
  useContacts(); // Prefetch contacts so composer autocomplete is instant
  const updateSettings = useUpdateSettings();
  const googleStatus = useGoogleAuthStatus();
  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;
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
  const { data: rawInboxEmails = [], isLoading: emailsLoading } =
    useEmails("inbox");
  // Augment emails: self-sent → "important" (or "note-to-self" if pinned)
  const inboxEmails = useMemo(() => {
    if (!isGoogleConnected) return rawInboxEmails;
    return rawInboxEmails.map((e) => {
      const isSelfSent = connectedEmails.has(e.from.email.toLowerCase());
      if (!isSelfSent) return e;
      const virtualLabel = hasNoteToSelf ? "note-to-self" : "important";
      if (e.labelIds.includes(virtualLabel)) return e;
      let labelIds = [...e.labelIds];
      if (hasNoteToSelf) labelIds = labelIds.filter((l) => l !== "important");
      if (!labelIds.includes(virtualLabel)) labelIds.push(virtualLabel);
      return { ...e, labelIds };
    });
  }, [rawInboxEmails, isGoogleConnected, connectedEmails, hasNoteToSelf]);
  const tabsLoading = labelsLoading || settingsLoading || emailsLoading;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Drag-to-reorder tabs
  const [dragPinnedId, setDragPinnedId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    tabIndex: number;
    side: "left" | "right";
  } | null>(null);

  // Compute thread counts per label from inbox emails, filtered by active accounts
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const pinnedShorts = pinnedLabels.map((l) =>
      l.includes("/")
        ? l
            .slice(l.lastIndexOf("/") + 1)
            .replace(/_/g, " ")
            .toLowerCase()
        : l.toLowerCase(),
    );
    // Filter emails by active accounts before counting
    const filtered =
      activeAccounts.size > 0
        ? inboxEmails.filter(
            (e) => e.accountEmail && activeAccounts.has(e.accountEmail),
          )
        : inboxEmails;
    // Find the latest message per thread (to mirror Superhuman's thread-level label logic)
    const latestByThread = new Map<string, (typeof filtered)[0]>();
    for (const e of filtered) {
      const key = e.threadId || e.id;
      const existing = latestByThread.get(key);
      if (!existing || new Date(e.date) > new Date(existing.date)) {
        latestByThread.set(key, e);
      }
    }
    const latestMessages = [...latestByThread.values()];
    // Count inbox threads: latest message must NOT belong to any pinned label
    counts["inbox"] = latestMessages.filter(
      (e) => !e.labelIds.some((lid) => pinnedShorts.includes(lid)),
    ).length;
    // Count threads per pinned label: latest message must have that label
    // For "important", exclude threads that belong to any other pinned tab
    for (let i = 0; i < pinnedLabels.length; i++) {
      const short = pinnedShorts[i];
      const full = pinnedLabels[i];
      const hasLabel = (e: (typeof filtered)[0]) =>
        e.labelIds.some((lid) => lid === short || lid === full);
      if (full === "important") {
        const otherShorts = pinnedShorts.filter((_, j) => j !== i);
        counts[full] = latestMessages.filter(
          (e) =>
            hasLabel(e) && !e.labelIds.some((lid) => otherShorts.includes(lid)),
        ).length;
      } else {
        counts[full] = latestMessages.filter((e) => hasLabel(e)).length;
      }
    }
    return counts;
  }, [inboxEmails, pinnedLabels, activeAccounts]);

  // Tabs to show in the bar: Inbox + pinned items (system views or labels)
  // Check if any pinned labels are category/label filters (not system views like starred/sent)
  const hasPinnedFilters = pinnedLabels.some(
    (id) => !collapsibleViews.some((v) => v.id === id),
  );

  const visibleTabs = useMemo(() => {
    const tabs: {
      id: string;
      pinnedId?: string;
      label: string;
      href: string;
      isActive: boolean;
      color?: string;
    }[] = [];

    // When there are pinned label/category filters, add them first,
    // then "Other" (inbox minus pinned). Otherwise just show "Inbox".
    if (!hasPinnedFilters) {
      tabs.push({
        id: "inbox",
        label: "Inbox",
        href: "/inbox",
        isActive: view === "inbox" && !activeLabel,
      });
    }

    const seenLabels = new Set<string>(["inbox"]);
    for (const id of pinnedLabels) {
      // Check if it's a system view
      const sysView = collapsibleViews.find((v) => v.id === id);
      if (sysView) {
        if (seenLabels.has(sysView.label.toLowerCase())) continue;
        seenLabels.add(sysView.label.toLowerCase());
        tabs.push({
          id: sysView.id,
          pinnedId: id,
          label: sysView.label,
          href: `/${sysView.id}`,
          isActive: view === sysView.id,
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
          href: `/inbox?label=${encodeURIComponent(lbl.id)}`,
          isActive: activeLabel === lbl.id,
          color: lbl.color,
        });
      }
    }

    // When there are pinned label/category filters, add "Other" at the end
    // (shows inbox emails not in any pinned label)
    if (hasPinnedFilters) {
      tabs.push({
        id: "inbox",
        label: "Other",
        href: "/inbox",
        isActive: view === "inbox" && !activeLabel,
      });
    }

    return tabs;
  }, [labels, pinnedLabels, labelAliases, view, activeLabel, hasPinnedFilters]);

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
  const { data: currentViewEmails = [] } = useEmails(view);
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
        const res = await fetch("/_agent-native/application-state/navigation");
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
      return currentViewEmails.find((e) => e.id === focusedListId);
    }
    // Fall back to the first email in the list — if it's auto-focused in the
    // UI but the navigation state hasn't synced yet, shortcuts should still work.
    return currentViewEmails[0] ?? undefined;
  }, [threadId, focusedListId, currentViewEmails]);

  const dismissEmail = useCallback((emailId: string) => {
    window.dispatchEvent(
      new CustomEvent("email:snoozed", { detail: { emailId } }),
    );
  }, []);

  const handleSpam = useCallback(() => {
    if (!targetEmail) {
      toast.error("No email selected.");
      return;
    }
    dismissEmail(targetEmail.id);
    reportSpam.mutate({
      id: targetEmail.id,
      threadId: targetEmail.threadId || targetEmail.id,
    });
    toast("Reported as spam.");
  }, [targetEmail, reportSpam, dismissEmail]);

  const handleBlockSender = useCallback(() => {
    if (!targetEmail) {
      toast.error("No email selected.");
      return;
    }
    dismissEmail(targetEmail.id);
    blockSender.mutate({
      id: targetEmail.id,
      threadId: targetEmail.threadId || targetEmail.id,
      senderEmail: targetEmail.from.email,
    });
    toast(`Reported as spam & blocked ${targetEmail.from.email}.`);
  }, [targetEmail, blockSender, dismissEmail]);

  const handleMuteThread = useCallback(() => {
    const tid =
      threadId ||
      (targetEmail ? targetEmail.threadId || targetEmail.id : undefined);
    if (!tid) {
      toast.error("No thread selected.");
      return;
    }
    if (targetEmail) dismissEmail(targetEmail.id);
    muteThread.mutate(tid);
    toast("Thread muted.");
  }, [threadId, targetEmail, muteThread, dismissEmail]);

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
    if (!targetEmail) {
      toast.error("No email selected.");
      return;
    }
    setSnoozeOverride(null);
    setSnoozeOpen(true);
  }, [targetEmail]);

  // Swipe-to-snooze: EmailList dispatches this when a row is swiped right.
  // We capture the email id here so the modal snoozes the swiped row even
  // if the user hasn't opened it (and navigation state still points
  // elsewhere).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ emailId: string; accountEmail?: string }>
      ).detail;
      if (!detail?.emailId) return;
      setSnoozeOverride({
        id: detail.emailId,
        accountEmail: detail.accountEmail,
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

  // Get unread counts for tabs
  const getTotalCount = (viewId: string) => {
    // Use our computed counts from inbox emails for pinned labels
    if (labelCounts[viewId] !== undefined) return labelCounts[viewId];
    // Fall back to server-reported label counts for system views
    const label = labels.find((l) => l.id === viewId);
    return label?.totalCount ?? 0;
  };

  const accountFilterValue = useMemo(
    () => ({ activeAccounts, allAccounts: accounts }),
    [activeAccounts, accounts],
  );

  return (
    <AccountFilterContext.Provider value={accountFilterValue}>
      <div className="flex h-screen overflow-hidden bg-background">
        <AgentSidebar
          position="right"
          defaultOpen={!isMobile}
          emptyStateText="Ask me anything about your emails"
          suggestions={[
            "What's in my inbox?",
            "Summarize my unread emails",
            "Show me the database schema",
          ]}
        >
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {/* Top nav bar */}
            <header className="relative z-20 flex h-11 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2 inbox-zero-header">
              {/* Hamburger menu */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
                title="Menu"
              >
                <IconMenu2 className="h-4 w-4" />
              </button>

              {/* Visible tabs — hidden during search */}
              {!activeSearchQuery && (
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
                    <nav className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
                      {visibleTabs.map((tab, idx) => {
                        const count = getTotalCount(tab.id);
                        const isDragging = dragPinnedId === tab.pinnedId;
                        const canDrag =
                          !!tab.pinnedId && tab.pinnedId !== "important";
                        const showLeft =
                          dropIndicator?.tabIndex === idx &&
                          dropIndicator.side === "left";
                        const showRight =
                          dropIndicator?.tabIndex === idx &&
                          dropIndicator.side === "right";
                        return (
                          <div
                            key={tab.pinnedId || tab.id}
                            className="relative flex items-center"
                            onDragOver={(e) => handleTabDragOver(e, idx)}
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
                          {collapsibleViews.find((v) => v.id === view)?.label}
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
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded transition-colors",
                            tabSettingsOpen
                              ? "text-foreground bg-accent/50"
                              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/30",
                          )}
                          title="Configure tabs"
                        >
                          <IconSettings className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
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
              )}

              <div className="flex-1" />

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
                <button
                  onClick={() => setSearchFocused(true)}
                  className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  title="Search (/)"
                >
                  <IconSearch className="h-4 w-4" />
                </button>
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

              {/* Theme toggle */}
              <ThemeToggle />

              {/* Compose (pen) icon */}
              <button
                onClick={handleCompose}
                className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Compose (C)"
              >
                <IconPencil className="h-4 w-4" />
              </button>

              {/* Account avatars — overlapping stack like Figma */}
              {hasAccounts && (
                <Popover
                  open={accountPopoverOpen}
                  onOpenChange={setAccountPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className="flex items-center hover:opacity-90 transition-opacity ml-1"
                      title="Accounts"
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
                                "relative rounded-full ring-2 ring-card transition-opacity",
                                !isActive && "opacity-30",
                              )}
                              style={{
                                marginLeft: i === 0 ? 0 : -8,
                                zIndex: accounts.length - i,
                              }}
                            >
                              {account.photoUrl ? (
                                <img
                                  src={account.photoUrl}
                                  alt=""
                                  className="h-7 w-7 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-semibold text-primary">
                                  {account.email[0]?.toUpperCase()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  </PopoverTrigger>
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

              <Link
                to="/tools"
                className="flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
                title="Tools"
              >
                <IconTool className="h-4 w-4" />
              </Link>

              <AgentToggleButton />
            </header>

            {/* Sidebar overlay */}
            {sidebarOpen && (
              <>
                <div
                  className="fixed inset-0 z-30 bg-black/20"
                  onClick={() => setSidebarOpen(false)}
                />
                <div className="fixed left-0 top-0 bottom-0 z-40 w-64 bg-background/70 backdrop-blur-2xl border-r border-border/30 shadow-2xl overflow-y-auto">
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
                                "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-all",
                                isActive ? "opacity-100" : "opacity-30",
                              )}
                            >
                              {account.photoUrl ? (
                                <img
                                  src={account.photoUrl}
                                  alt=""
                                  className="h-8 w-8 rounded-full object-cover shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-[12px] font-semibold text-primary shrink-0">
                                  {account.email[0]?.toUpperCase()}
                                </div>
                              )}
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
                        { id: "inbox", label: "Inbox", href: "/inbox" },
                        { id: "starred", label: "Starred", href: "/starred" },
                        { id: "snoozed", label: "Snoozed", href: "/snoozed" },
                        { id: "sent", label: "Sent", href: "/sent" },
                        {
                          id: "scheduled",
                          label: "Scheduled",
                          href: "/scheduled",
                        },
                        { id: "drafts", label: "Drafts", href: "/drafts" },
                        { id: "archive", label: "Done", href: "/archive" },
                        { id: "trash", label: "Trash", href: "/trash" },
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
                          {item.id === "inbox" && labelCounts["inbox"] > 0 && (
                            <span className="text-[12px] text-muted-foreground/50 tabular-nums">
                              {labelCounts["inbox"]}
                            </span>
                          )}
                        </Link>
                      ))}
                      <div className="mt-2 pt-2 border-t border-border/20">
                        <Link
                          to="/settings"
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            "flex items-center rounded-md px-3 py-2.5 text-[14px] transition-colors min-h-[44px]",
                            location.pathname === "/settings"
                              ? "bg-accent/60 text-foreground font-medium"
                              : "text-foreground/70 hover:bg-accent/30",
                          )}
                        >
                          Settings
                        </Link>
                        <div className="mt-1">
                          <ToolsSidebarSection />
                        </div>
                        <div className="mt-1">
                          <FeedbackButton />
                        </div>
                        <div className="mt-2 px-1">
                          <OrgSwitcher />
                        </div>
                      </div>
                    </div>

                    {/* Pinned labels */}
                    {pinnedLabels.filter(
                      (l) => !collapsibleViews.some((v) => v.id === l),
                    ).length > 0 && (
                      <>
                        <h2 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mt-5 mb-3">
                          Labels
                        </h2>
                        <div className="space-y-0.5">
                          {visibleTabs
                            .filter(
                              (t) =>
                                t.id !== "inbox" &&
                                !collapsibleViews.some((v) => v.id === t.id),
                            )
                            .map((tab) => {
                              const count = getTotalCount(tab.id);
                              return (
                                <Link
                                  key={tab.id}
                                  to={tab.href}
                                  onClick={() => setSidebarOpen(false)}
                                  className={cn(
                                    "flex items-center justify-between rounded-md px-3 py-2.5 text-[14px] transition-colors min-h-[44px]",
                                    tab.isActive
                                      ? "bg-accent/60 text-foreground font-medium"
                                      : "text-foreground/70 hover:bg-accent/30",
                                  )}
                                >
                                  <span className="flex items-center gap-2">
                                    {tab.color && (
                                      <span
                                        className="h-2 w-2 rounded-full shrink-0"
                                        style={{ backgroundColor: tab.color }}
                                      />
                                    )}
                                    {tab.label}
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
              </>
            )}

            <InvitationBanner />

            {/* Show full-page takeover when no accounts connected (except on settings page) */}
            {!googleStatus.isLoading &&
            !googleStatus.isError &&
            !hasAccounts &&
            view !== "settings" ? (
              <GoogleConnectBanner variant="hero" />
            ) : (
              <main className="flex flex-1 overflow-hidden">{children}</main>
            )}
          </div>
        </AgentSidebar>

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
                          fetch(`/api/emails/${snapshot.savedDraftId}`, {
                            method: "DELETE",
                          });
                        }
                      },
                    },
                  });
                }
              }}
              onCloseAll={() => {
                const draftsWithContent = popoutDrafts.filter(
                  (d) =>
                    !!(d.to?.trim() || d.subject?.trim() || d.body?.trim()),
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
                            fetch(`/api/emails/${snap.savedDraftId}`, {
                              method: "DELETE",
                            });
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
          emailId={snoozeOverride?.id ?? targetEmail?.id ?? null}
          accountEmail={
            snoozeOverride?.accountEmail ?? targetEmail?.accountEmail
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
      </div>
    </AccountFilterContext.Provider>
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
      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left hover:bg-accent/50 transition-colors"
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
  systemViews: { id: string; label: string }[];
  userLabels: Label[];
  pinnedLabels: string[];
  labelAliases: Record<string, string>;
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, alias: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const q = search.toLowerCase();

  const filteredViews = search
    ? systemViews.filter((v) => v.label.toLowerCase().includes(q))
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
          placeholder="Search..."
          className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none px-1 py-0.5"
        />
      </div>

      <div className="max-h-72 overflow-y-auto">
        {noResults && (
          <p className="px-3 py-3 text-[12px] text-muted-foreground/50">
            No matches
          </p>
        )}

        {/* System views */}
        {showViews && (
          <div>
            <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
              Views
            </p>
            {filteredViews.map((v) => (
              <CheckboxRow
                key={v.id}
                checked={pinnedLabels.includes(v.id)}
                label={v.label}
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
              Categories
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
              Labels
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
                    <button
                      onClick={() => {
                        setEditingId(label.id);
                        setEditValue(alias || "");
                      }}
                      className="shrink-0 mr-2 px-1 py-0.5 text-[10px] text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 rounded hover:bg-accent/50"
                      title="Rename tab"
                    >
                      Rename
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border/30">
        <p className="text-[11px] text-muted-foreground/40">
          Checked items show as tabs. Label emails split from inbox.
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
  accounts: Array<{ email: string; photoUrl?: string }>;
  activeAccounts: Set<string>;
  onToggleAccount: (email: string) => void;
  onRemoveAccount: (email: string) => void;
}) {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const disconnectGoogle = useDisconnectGoogle();

  useEffect(() => {
    if (!wantAuthUrl || !authUrl.data?.url) return;
    setWantAuthUrl(false);
    window.open(authUrl.data.url, "_blank");

    const interval = setInterval(async () => {
      const res = await fetch("/_agent-native/google/status").catch(() => null);
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
          Accounts
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
              {account.photoUrl ? (
                <img
                  src={account.photoUrl}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                  {account.email[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[13px] text-foreground/80 truncate flex-1">
                {account.email}
              </span>
              <button
                onClick={() => {
                  onRemoveAccount(account.email);
                  disconnectGoogle.mutate(account.email);
                }}
                className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-red-400 transition-all"
              >
                Remove
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
          {authUrl.isFetching ? "Connecting..." : "Add account"}
        </button>
      </div>
    </>
  );
}
