import { PanelLeftClose, PanelLeft, Box, Film } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

type StudioHeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
};

export function StudioHeader({
  sidebarOpen,
  onToggleSidebar,
}: StudioHeaderProps) {
  const location = useLocation();
  const isComponentLibrary = location.pathname === "/components";

  return (
    <header className="flex items-center justify-between px-4 h-12 border-b border-border bg-card/80 backdrop-blur-xl z-10 flex-shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>

        <div className="w-px h-5 bg-border" />

        <h1 className="text-sm font-semibold tracking-tight">
          Video Studio
        </h1>

        <div className="w-px h-5 bg-border" />

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          <Link
            to="/"
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
              !isComponentLibrary
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Film className="w-3.5 h-3.5" />
            Animations
          </Link>
          <Link
            to="/components"
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
              isComponentLibrary
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <Box className="w-3.5 h-3.5" />
            Components
          </Link>
        </nav>
      </div>
    </header>
  );
}
