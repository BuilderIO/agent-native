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
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/50 bg-[hsl(220,6%,9%)] px-2">
          {/* Hamburger / menu icon */}
          <button
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/inbox")}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75z"
                clipRule="evenodd"
              />
            </svg>
          </button>

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

        <GoogleConnectBanner />

        {/* Page content */}
        <main className="flex flex-1 overflow-hidden">{children}</main>

        {/* Bottom bar */}
        <div className="hidden md:flex h-8 shrink-0 items-center justify-between border-t border-border/40 bg-[hsl(220,6%,8%)] px-3">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground cursor-pointer transition-colors">
            Add to Team
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M8.5 4.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM10.9 12.006C10.314 10.26 8.617 9 6.5 9 3.985 9 2 11.015 2 13.5c0 .275.225.5.5.5h8c.275 0 .5-.225.5-.5 0-.177-.012-.351-.036-.52a.496.496 0 0 1-.064-.474zM12.5 6a.5.5 0 0 1 .5.5V8h1.5a.5.5 0 0 1 0 1H13v1.5a.5.5 0 0 1-1 0V9h-1.5a.5.5 0 0 1 0-1H12V6.5a.5.5 0 0 1 .5-.5z" />
            </svg>
          </span>
          <div className="flex items-center gap-2">
            {/* Calendar */}
            <button
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Calendar"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path d="M4.5 1a.75.75 0 0 1 .75.75V3h5.5V1.75a.75.75 0 0 1 1.5 0V3h.5A2.25 2.25 0 0 1 15 5.25v7.5A2.25 2.25 0 0 1 12.75 15h-9.5A2.25 2.25 0 0 1 1 12.75v-7.5A2.25 2.25 0 0 1 3.25 3h.5V1.75A.75.75 0 0 1 4.5 1zM2.5 7v5.75c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75V7h-11z" />
              </svg>
            </button>
            {/* Help */}
            <button
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Help"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0zm-6 3.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7.293 5.293a1 1 0 0 1 1.414 0 .75.75 0 0 0 1.06-1.06 2.5 2.5 0 0 0-3.535 3.535.75.75 0 0 0 1.06-1.06 1 1 0 0 1 0-1.415z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {/* Shortcuts */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Keyboard shortcuts"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path d="M1 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6zm4 1.5a.5.5 0 0 0-1 0v1a.5.5 0 0 0 1 0v-1zm2 0a.5.5 0 0 0-1 0v1a.5.5 0 0 0 1 0v-1zm2 0a.5.5 0 0 0-1 0v1a.5.5 0 0 0 1 0v-1zm2 0a.5.5 0 0 0-1 0v1a.5.5 0 0 0 1 0v-1z" />
              </svg>
            </button>
            {/* Settings */}
            <button
              onClick={() => navigate("/settings")}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title="Settings"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.916a.5.5 0 0 1 .67.077l.774.775a.5.5 0 0 1 .078.67l-.916 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.497v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.916 1.321a.5.5 0 0 1-.077.67l-.775.774a.5.5 0 0 1-.67.078l-1.32-.916a5.45 5.45 0 0 1-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a5.45 5.45 0 0 1-1.356-.562l-1.321.916a.5.5 0 0 1-.67-.077l-.774-.775a.5.5 0 0 1-.078-.67l.916-1.32a5.45 5.45 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.916-1.321a.5.5 0 0 1 .077-.67l.775-.774a.5.5 0 0 1 .67-.078l1.32.916A5.45 5.45 0 0 1 6.786 3.15l.17-1.699zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
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
