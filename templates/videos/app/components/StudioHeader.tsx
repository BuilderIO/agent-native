import { useState } from "react";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebar,
  IconShare2,
  IconUsers,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";
import { AgentToggleButton } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
  const isTeam = location.pathname === "/team";
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between px-2 sm:px-4 h-12 border-b border-border bg-card/80 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <button
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            className="p-2 sm:p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            {sidebarOpen ? (
              <IconLayoutSidebarLeftCollapse size={18} />
            ) : (
              <IconLayoutSidebar size={18} />
            )}
          </button>

          <div className="w-px h-5 bg-border hidden sm:block" />

          <h1 className="text-sm font-semibold tracking-tight hidden sm:block">
            Video Studio
          </h1>

          <div className="w-px h-5 bg-border hidden sm:block" />

          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className={cn(
                "px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md",
                !isComponentLibrary && !isTeam
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              Animations
            </Link>
            <Link
              to="/components"
              className={cn(
                "px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md",
                isComponentLibrary
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              Components
            </Link>
            <Link
              to="/team"
              className={cn(
                "px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5",
                isTeam
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              <IconUsers size={14} />
              <span className="hidden sm:inline">Team</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => {
              if (isLocal) {
                setShowCloudUpgrade(true);
              } else {
                // Future: implement share/export flow
              }
            }}
            aria-label="Share"
            className="p-2 sm:px-3 sm:py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex items-center gap-1.5"
          >
            <IconShare2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <AgentToggleButton />
        </div>
      </header>

      <Dialog open={showCloudUpgrade} onOpenChange={setShowCloudUpgrade}>
        <DialogContent className="sm:max-w-lg p-0 border-none bg-transparent shadow-none [&>button]:hidden">
          <CloudUpgrade
            title="Share Videos"
            description="To share or export videos, connect a cloud database so your compositions can be accessed from anywhere."
            onClose={() => setShowCloudUpgrade(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
