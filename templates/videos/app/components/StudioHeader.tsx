import { useState } from "react";
import { PanelLeftClose, PanelLeft, Share2 } from "lucide-react";
import { Link, useLocation } from "react-router";
import { AgentToggleButton } from "@agent-native/core/client";
import { cn } from "@/lib/utils";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";

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
  const { isLocal } = useDbStatus();
  const [showCloudUpgrade, setShowCloudUpgrade] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between px-4 h-12 border-b border-border bg-card/80 backdrop-blur-xl z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {sidebarOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeft size={16} />
            )}
          </button>

          <div className="w-px h-5 bg-border" />

          <h1 className="text-sm font-semibold tracking-tight">Video Studio</h1>

          <div className="w-px h-5 bg-border" />

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                !isComponentLibrary
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              Animations
            </Link>
            <Link
              to="/components"
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                isComponentLibrary
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              Components
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (isLocal) {
                setShowCloudUpgrade(true);
              } else {
                // Future: implement share/export flow
              }
            }}
            aria-label="Share"
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex items-center gap-1.5"
          >
            <Share2 className="w-3.5 h-3.5" />
            Share
          </button>
          <AgentToggleButton />
        </div>
      </header>

      {showCloudUpgrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <CloudUpgrade
            title="Share Videos"
            description="To share or export videos, connect a cloud database so your compositions can be accessed from anywhere."
            onClose={() => setShowCloudUpgrade(false)}
          />
        </div>
      )}
    </>
  );
}
