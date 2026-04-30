import { useState } from "react";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebar,
  IconShare2,
} from "@tabler/icons-react";
import { AgentToggleButton } from "@agent-native/core/client";
import { useDbStatus } from "@/hooks/use-db-status";
import { CloudUpgrade } from "@/components/CloudUpgrade";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type StudioHeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
};

export function StudioHeader({
  sidebarOpen,
  onToggleSidebar,
}: StudioHeaderProps) {
  const { isLocal } = useDbStatus();
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <header className="flex items-center justify-between px-2 sm:px-4 h-12 border-b border-border bg-card/80 backdrop-blur-xl z-10 flex-shrink-0">
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          className="p-2 sm:p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer"
        >
          {sidebarOpen ? (
            <IconLayoutSidebarLeftCollapse size={18} />
          ) : (
            <IconLayoutSidebar size={18} />
          )}
        </button>

        <div className="w-px h-5 bg-border hidden sm:block" />

        <h1 className="text-sm font-semibold tracking-tight hidden sm:block">
          Videos
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {isLocal ? (
          <Popover open={shareOpen} onOpenChange={setShareOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="Share"
                className="p-2 sm:px-3 sm:py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex items-center gap-1.5 cursor-pointer"
              >
                <IconShare2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Share</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-auto p-0 border-none bg-transparent shadow-none"
            >
              <CloudUpgrade
                title="Share Videos"
                description="To share or export videos, connect a cloud database so your compositions can be accessed from anywhere."
                onClose={() => setShareOpen(false)}
              />
            </PopoverContent>
          </Popover>
        ) : (
          <button
            aria-label="Share"
            className="p-2 sm:px-3 sm:py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex items-center gap-1.5 cursor-pointer"
          >
            <IconShare2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
        )}
        <AgentToggleButton />
      </div>
    </header>
  );
}
