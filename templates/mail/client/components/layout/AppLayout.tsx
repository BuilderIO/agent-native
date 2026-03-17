import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { IconChevronRight, IconChevronLeft } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ComposeModal } from "@/components/email/ComposeModal";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { runUndo } from "@/hooks/use-undo";
import { useLabels, useSettings, useUpdateSettings } from "@/hooks/use-emails";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useDisconnectGoogle,
} from "@/hooks/use-google-auth";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { getCallbackOrigin } from "@agent-native/core/client";
import type { Label } from "@shared/types";

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
  const compose = useComposeState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
  const { data: labels = [] } = useLabels();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const googleStatus = useGoogleAuthStatus();
  const accounts = googleStatus.data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const tabSettingsRef = useRef<HTMLDivElement>(null);

  const pinnedLabels = settings?.pinnedLabels ?? [];

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

    for (const id of pinnedLabels) {
      // Check if it's a system view
      const sysView = collapsibleViews.find((v) => v.id === id);
      if (sysView) {
        tabs.push({
          id: sysView.id,
          label: sysView.label,
          href: `/${sysView.id}`,
          isActive: view === sysView.id,
        });
        continue;
      }
      // Check if it's a user label
      const lbl = labels.find(
        (l) => l.id === id || l.name.toLowerCase() === id.toLowerCase(),
      );
      if (lbl) {
        tabs.push({
          id: lbl.id,
          label: lbl.name,
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
  const userLabels = useMemo(
    () =>
      labels.filter(
        (l) => !["inbox", ...collapsibleViews.map((v) => v.id)].includes(l.id),
      ),
    [labels],
  );

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
    { key: "z", handler: runUndo },
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
  const getUnreadCount = (viewId: string) => {
    const label = labels.find((l) => l.id === viewId);
    return label?.unreadCount ?? 0;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav bar — hidden when viewing a thread */}
        {!threadId && (
          <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
            {/* Visible tabs */}
            <nav className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
              {visibleTabs.map((tab) => {
                const count = getUnreadCount(tab.id);
                return (
                  <Link
                    key={tab.id}
                    to={tab.href}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[13px] transition-colors",
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

              {/* If current view is hidden, show it as an active tab */}
              {currentInHidden && (
                <span className="flex items-center whitespace-nowrap px-2.5 py-1 text-[13px] text-foreground font-semibold">
                  {collapsibleViews.find((v) => v.id === view)?.label}
                </span>
              )}

              {/* "More" expands hidden system views inline */}
              {hiddenViews.length > 0 && (
                <>
                  {moreOpen ? (
                    <>
                      {hiddenViews.map((v) => {
                        const isActive = view === v.id;
                        return (
                          <Link
                            key={v.id}
                            to={`/${v.id}`}
                            className={cn(
                              "flex items-center whitespace-nowrap px-2.5 py-1 text-[13px] transition-colors",
                              isActive
                                ? "text-foreground font-semibold"
                                : "text-muted-foreground font-medium hover:text-foreground/80",
                            )}
                          >
                            {v.label}
                          </Link>
                        );
                      })}
                      <button
                        onClick={() => setMoreOpen(false)}
                        className="flex h-6 w-6 items-center justify-center rounded transition-colors text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/30"
                      >
                        <IconChevronLeft size={18} stroke={2.5} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setMoreOpen(true)}
                      className="flex h-6 w-6 items-center justify-center rounded transition-colors text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/30"
                    >
                      <IconChevronRight size={18} stroke={2.5} />
                    </button>
                  )}
                </>
              )}
            </nav>

            {/* Tab settings cog */}
            <div className="relative" ref={tabSettingsRef}>
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

            {/* Account avatar */}
            {hasAccounts && (
              <div className="relative ml-1" ref={popoverRef}>
                <button
                  onClick={() => setAccountPopoverOpen(!accountPopoverOpen)}
                  className="flex h-7 w-7 items-center justify-center rounded-full overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all"
                  title="Accounts"
                >
                  {accounts[0]?.photoUrl ? (
                    <img
                      src={accounts[0].photoUrl}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[11px] font-semibold text-primary">
                      {accounts[0]?.email?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                </button>

                {accountPopoverOpen && (
                  <AccountPopover
                    accounts={accounts}
                    onClose={() => setAccountPopoverOpen(false)}
                  />
                )}
              </div>
            )}
          </header>
        )}

        {/* Show full-page takeover when no accounts connected, otherwise content */}
        {!googleStatus.isLoading && !hasAccounts ? (
          <GoogleConnectBanner variant="hero" />
        ) : (
          <main className="flex flex-1 overflow-hidden">{children}</main>
        )}
      </div>

      {compose.data && (
        <ComposeModal
          composeState={compose.data}
          onUpdate={compose.update}
          onClose={compose.clear}
          onFlush={compose.flush}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCompose={handleCompose}
      />
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
                label={label.name}
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
  onClose,
}: {
  accounts: Array<{ email: string; photoUrl?: string }>;
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

  return (
    <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-border/50 bg-card shadow-xl">
      <div className="px-3 py-2 border-b border-border/30">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Accounts
        </p>
      </div>

      <div className="py-1">
        {accounts.map((account) => (
          <div
            key={account.email}
            className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors group"
          >
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
              onClick={() => disconnectGoogle.mutate(account.email)}
              className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-red-400 transition-all"
            >
              Remove
            </button>
          </div>
        ))}
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
