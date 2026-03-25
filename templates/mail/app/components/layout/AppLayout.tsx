import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router";
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
import {
  getCallbackOrigin,
  AgentSidebar,
  AgentToggleButton,
} from "@agent-native/core/client";
import type { Label } from "@shared/types";
import { toast } from "sonner";

import { AccountFilterContext } from "@/hooks/use-account-filter";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const compose = useComposeState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  // Parse view and threadId from pathname since AppLayout is outside <Routes>
  const pathSegments = location.pathname.split("/").filter(Boolean);
  const view = pathSegments[0] || "inbox";
  const threadId = pathSegments[1] || undefined;
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const tabSettingsRef = useRef<HTMLDivElement>(null);

  const pinnedLabels = settings?.pinnedLabels ?? [];
  const { data: inboxEmails = [], isLoading: emailsLoading } =
    useEmails("inbox");
  const tabsLoading = labelsLoading || settingsLoading || emailsLoading;
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    for (let i = 0; i < pinnedLabels.length; i++) {
      const short = pinnedShorts[i];
      const full = pinnedLabels[i];
      counts[full] = latestMessages.filter((e) =>
        e.labelIds.some((lid) => lid === short || lid === full),
      ).length;
    }
    return counts;
  }, [inboxEmails, pinnedLabels, activeAccounts]);

  // Tabs to show in the bar: Inbox + pinned items (system views or labels)
  const visibleTabs = useMemo(() => {
    const tabs: {
      id: string;
      label: string;
      href: string;
      isActive: boolean;
      color?: string;
    }[] = [
      {
        id: "inbox",
        label: "Inbox",
        href: "/inbox",
        isActive: view === "inbox" && !activeLabel,
      },
    ];

    const seenLabels = new Set<string>(["inbox"]);
    for (const id of pinnedLabels) {
      // Check if it's a system view
      const sysView = collapsibleViews.find((v) => v.id === id);
      if (sysView) {
        if (seenLabels.has(sysView.label.toLowerCase())) continue;
        seenLabels.add(sysView.label.toLowerCase());
        tabs.push({
          id: sysView.id,
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
        const displayName = shortLabelName(lbl.name).toLowerCase();
        if (seenLabels.has(displayName)) continue;
        seenLabels.add(displayName);
        tabs.push({
          id: lbl.id,
          label: shortLabelName(lbl.name),
          href: `/inbox?label=${encodeURIComponent(lbl.id)}`,
          isActive: activeLabel === lbl.id,
          color: lbl.color,
        });
      }
    }
    return tabs;
  }, [labels, pinnedLabels, view, activeLabel]);

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

  // Close popovers on outside click
  useEffect(() => {
    if (!accountPopoverOpen && !tabSettingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        accountPopoverOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setAccountPopoverOpen(false);
      }
      if (
        tabSettingsOpen &&
        tabSettingsRef.current &&
        !tabSettingsRef.current.contains(e.target as Node)
      ) {
        setTabSettingsOpen(false);
        setLabelSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountPopoverOpen, tabSettingsOpen]);

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
        const res = await fetch("/api/application-state/navigation");
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
    return undefined;
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
    reportSpam.mutate(targetEmail.id);
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

  const handleSearch = (q: string) => {
    if (q.trim()) {
      navigate(`/inbox?q=${encodeURIComponent(q.trim())}`);
    }
  };

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
    setSnoozeOpen(true);
  }, [targetEmail]);

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
      },
    },
  ]);

  // Sequence shortcuts (g + key = go to view)
  useSequenceShortcuts([
    { keys: ["g", "i"], handler: () => navigate("/inbox") },
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
        {/* Main content area */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* Top nav bar */}
          <header className="relative z-20 flex h-11 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2 inbox-zero-header">
            {/* Hamburger menu */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
              title="Menu"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path
                  fillRule="evenodd"
                  d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Agent chat toggle */}
            <AgentToggleButton />

            {/* Visible tabs */}
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
                {visibleTabs.map((tab) => {
                  const count = getTotalCount(tab.id);
                  return (
                    <Link
                      key={tab.id}
                      to={tab.href}
                      className={cn(
                        "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[13px]",
                        tab.isActive
                          ? "text-foreground font-semibold"
                          : "text-muted-foreground font-medium hover:text-foreground/80",
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
            <div
              className={cn("relative", tabsLoading && "invisible")}
              ref={tabSettingsRef}
            >
              <button
                onClick={() => setTabSettingsOpen(!tabSettingsOpen)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded transition-colors",
                  tabSettingsOpen
                    ? "text-foreground bg-accent/50"
                    : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/30",
                )}
                title="Configure tabs"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {tabSettingsOpen && (
                <TabSettingsPopover
                  systemViews={collapsibleViews}
                  userLabels={userLabels}
                  pinnedLabels={pinnedLabels}
                  search={labelSearch}
                  onSearchChange={setLabelSearch}
                  onToggle={togglePinned}
                />
              )}
            </div>

            <div className="flex-1" />

            {/* Search */}
            {searchFocused ? (
              <div className="flex items-center gap-1.5">
                <input
                  id="mail-search"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch(searchQuery);
                    if (e.key === "Escape") {
                      setSearchQuery("");
                      setSearchFocused(false);
                    }
                  }}
                  onBlur={() => {
                    if (!searchQuery) setSearchFocused(false);
                  }}
                  placeholder="Search..."
                  className="h-7 w-48 rounded bg-accent/80 border-none px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            ) : (
              <button
                onClick={() => setSearchFocused(true)}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Search (/)"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}

            {/* Hidden input for keyboard shortcut target */}
            {!searchFocused && (
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
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title="Compose (C)"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343z" />
              </svg>
            </button>

            {/* Account avatars — overlapping stack like Figma */}
            {hasAccounts && (
              <div className="relative ml-1" ref={popoverRef}>
                <button
                  onClick={() => setAccountPopoverOpen(!accountPopoverOpen)}
                  className="flex items-center hover:opacity-90 transition-opacity"
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

                {accountPopoverOpen && (
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
                    onClose={() => setAccountPopoverOpen(false)}
                  />
                )}
              </div>
            )}
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
                          "flex items-center justify-between rounded-md px-3 py-2 text-[14px] transition-colors",
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
                          "flex items-center rounded-md px-3 py-2 text-[14px] transition-colors",
                          location.pathname === "/settings"
                            ? "bg-accent/60 text-foreground font-medium"
                            : "text-foreground/70 hover:bg-accent/30",
                        )}
                      >
                        Settings
                      </Link>
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
                                  "flex items-center justify-between rounded-md px-3 py-2 text-[14px] transition-colors",
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

          {/* Show full-page takeover when no accounts connected, otherwise content */}
          <AgentSidebar
            position="left"
            defaultOpen={!isMobile}
            emptyStateText="Ask me anything about your emails"
            suggestions={[
              "What's in my inbox?",
              "Summarize my unread emails",
              "Show me the database schema",
            ]}
          >
            {!googleStatus.isLoading && !hasAccounts ? (
              <GoogleConnectBanner variant="hero" />
            ) : (
              <main className="flex flex-1 overflow-hidden">{children}</main>
            )}
          </AgentSidebar>
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
          emailId={targetEmail?.id ?? null}
          onClose={() => setSnoozeOpen(false)}
          onSnoozed={() => setSnoozeOpen(false)}
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
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-2.5 w-2.5 text-primary-foreground"
          >
            <path
              fillRule="evenodd"
              d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
              clipRule="evenodd"
            />
          </svg>
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
  search,
  onSearchChange,
  onToggle,
}: {
  systemViews: { id: string; label: string }[];
  userLabels: Label[];
  pinnedLabels: string[];
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: string) => void;
}) {
  const q = search.toLowerCase();

  const filteredViews = search
    ? systemViews.filter((v) => v.label.toLowerCase().includes(q))
    : systemViews;

  const filteredLabels = search
    ? userLabels.filter((l) => l.name.toLowerCase().includes(q))
    : userLabels;

  // Sort: pinned first, then alphabetical
  const sortedLabels = [...filteredLabels].sort((a, b) => {
    const ap = pinnedLabels.includes(a.id) ? 0 : 1;
    const bp = pinnedLabels.includes(b.id) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });

  const showViews = filteredViews.length > 0;
  const showLabels = sortedLabels.length > 0;
  const noResults = !showViews && !showLabels && search;

  return (
    <div className="absolute left-0 top-full mt-1.5 z-50 w-60 rounded-lg border border-border/50 bg-card shadow-xl">
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

        {/* User labels */}
        {showLabels && (
          <div>
            <p
              className={cn(
                "px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider",
                showViews && "border-t border-border/20 mt-1",
              )}
            >
              Labels
            </p>
            {sortedLabels.map((label) => (
              <CheckboxRow
                key={label.id}
                checked={pinnedLabels.includes(label.id)}
                label={shortLabelName(label.name)}
                color={label.color}
                onToggle={() => onToggle(label.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border/30">
        <p className="text-[11px] text-muted-foreground/40">
          Checked items show as tabs. Label emails split from inbox.
        </p>
      </div>
    </div>
  );
}

// ─── Account Popover ─────────────────────────────────────────────────────────

function AccountPopover({
  accounts,
  activeAccounts,
  onToggleAccount,
  onRemoveAccount,
  onClose,
}: {
  accounts: Array<{ email: string; photoUrl?: string }>;
  activeAccounts: Set<string>;
  onToggleAccount: (email: string) => void;
  onRemoveAccount: (email: string) => void;
  onClose: () => void;
}) {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);
  const disconnectGoogle = useDisconnectGoogle();

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);

      const interval = setInterval(async () => {
        const res = await fetch("/api/google/status").catch(() => null);
        if (res?.ok) {
          const data = await res.json();
          if (data.accounts?.length > accounts.length) {
            clearInterval(interval);
            window.location.reload();
          }
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [authUrl.data, accounts.length]);

  // Empty activeAccounts means "all selected"
  const allSelected = activeAccounts.size === 0;

  return (
    <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-border/50 bg-card shadow-xl">
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
                    <svg
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-2.5 w-2.5 text-primary-foreground"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                        clipRule="evenodd"
                      />
                    </svg>
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
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
          </svg>
          {authUrl.isFetching ? "Connecting..." : "Add account"}
        </button>
      </div>
    </div>
  );
}
