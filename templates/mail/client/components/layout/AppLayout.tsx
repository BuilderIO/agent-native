import { useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { ComposeModal } from "@/components/email/ComposeModal";
import {
  useKeyboardShortcuts,
  useSequenceShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { useLabels, useSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";

interface AppLayoutProps {
  children: React.ReactNode;
}

const categoryTabs = [
  { id: "inbox", label: "Important", view: "inbox" },
  { id: "starred", label: "Starred", view: "starred" },
  { id: "sent", label: "Sent", view: "sent" },
  { id: "archive", label: "Archive", view: "archive" },
  { id: "drafts", label: "Drafts", view: "drafts" },
  { id: "trash", label: "Trash", view: "trash" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const { view = "inbox" } = useParams<{ view: string }>();
  const { data: labels = [] } = useLabels();
  const { data: settings } = useSettings();
  const googleStatus = useGoogleAuthStatus();
  const hasAccounts = (googleStatus.data?.accounts ?? []).length > 0;

  const handleCompose = useCallback(() => setComposeOpen(true), []);

  const handleSearch = (q: string) => {
    if (q.trim()) {
      navigate(`/inbox?q=${encodeURIComponent(q.trim())}`);
    }
  };

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
    {
      key: "Escape",
      handler: () => {
        setSearchQuery("");
        setSearchFocused(false);
        (document.getElementById("mail-search") as HTMLInputElement)?.blur();
      },
    },
  ]);

  // Sequence shortcuts (g + i = go inbox, etc.)
  useSequenceShortcuts([
    { keys: ["g", "i"], handler: () => navigate("/inbox") },
    { keys: ["g", "s"], handler: () => navigate("/starred") },
    { keys: ["g", "t"], handler: () => navigate("/sent") },
    { keys: ["g", "d"], handler: () => navigate("/drafts") },
    { keys: ["g", "a"], handler: () => navigate("/archive") },
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
        {/* Top nav bar */}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
          {/* Category tabs */}
          <nav className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
            {categoryTabs.map((tab) => {
              const isActive =
                view === tab.view || (tab.view === "inbox" && view === "inbox");
              const count = getUnreadCount(tab.view);
              return (
                <Link
                  key={tab.id}
                  to={`/${tab.view}`}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[13px] transition-colors",
                    isActive
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground font-medium hover:text-foreground/80",
                  )}
                >
                  {tab.label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "text-[11px] tabular-nums",
                        isActive
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
          </nav>

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
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
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
        </header>

        {/* Show full-page takeover when no accounts connected, otherwise inline banner + content */}
        {!googleStatus.isLoading && !hasAccounts ? (
          <GoogleConnectBanner variant="hero" />
        ) : (
          <>
            <GoogleConnectBanner variant="banner" />
            <main className="flex flex-1 overflow-hidden">{children}</main>
          </>
        )}
      </div>

      <ComposeModal open={composeOpen} onOpenChange={setComposeOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCompose={handleCompose}
      />
    </div>
  );
}
