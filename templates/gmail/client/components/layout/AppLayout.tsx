import { useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Menu, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { ComposeModal } from "@/components/email/ComposeModal";
import { useKeyboardShortcuts, useSequenceShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useSettings } from "@/hooks/use-emails";
import { getInitials, getAvatarColor } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const { view } = useParams<{ view: string }>();
  const { data: settings } = useSettings();
  const { setTheme } = useTheme();

  const handleCompose = useCallback(() => setComposeOpen(true), []);

  const handleSearch = (q: string) => {
    if (q.trim()) {
      navigate(`/inbox?q=${encodeURIComponent(q.trim())}`);
    }
  };

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    { key: "k", meta: true, handler: () => setPaletteOpen(true), skipInInput: false },
    { key: "/", handler: () => {
      document.getElementById("mail-search")?.focus();
    }},
    { key: "c", handler: handleCompose },
    { key: "Escape", handler: () => {
      setSearchQuery("");
      (document.getElementById("mail-search") as HTMLInputElement)?.blur();
    }},
  ]);

  // Sequence shortcuts (g + i = go inbox, etc.)
  useSequenceShortcuts([
    { keys: ["g", "i"], handler: () => navigate("/inbox") },
    { keys: ["g", "s"], handler: () => navigate("/starred") },
    { keys: ["g", "t"], handler: () => navigate("/sent") },
    { keys: ["g", "d"], handler: () => navigate("/drafts") },
    { keys: ["g", "a"], handler: () => navigate("/archive") },
  ]);

  const userInitials = settings ? getInitials(settings.name) : "AJ";
  const avatarColor = settings ? getAvatarColor(settings.name) : "bg-blue-500";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCompose={handleCompose}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search */}
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              id="mail-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch(searchQuery);
                if (e.key === "Escape") {
                  setSearchQuery("");
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search mail..."
              className="pl-9 pr-9 h-9 rounded-full bg-muted/60 border-transparent focus-visible:bg-background focus-visible:border-border focus-visible:ring-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:flex gap-1.5 text-xs text-muted-foreground"
              onClick={() => setPaletteOpen(true)}
            >
              <kbd className="kbd-hint">⌘</kbd>
              <kbd className="kbd-hint">K</kbd>
            </Button>

            {/* Avatar / account menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className={`${avatarColor} text-white text-xs`}>
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{settings?.name ?? "Alex Johnson"}</p>
                  <p className="text-xs text-muted-foreground">{settings?.email ?? "me@example.com"}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme("light")}>
                  <Sun className="mr-2 h-4 w-4" /> Light mode
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>
                  <Moon className="mr-2 h-4 w-4" /> Dark mode
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Monitor className="mr-2 h-4 w-4" /> System
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex flex-1 overflow-hidden">{children}</main>
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
