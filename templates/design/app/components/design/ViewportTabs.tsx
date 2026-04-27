import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ViewportTab } from "./types";

interface ViewportTabsProps {
  tabs: ViewportTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabAdd: () => void;
}

export function ViewportTabs({
  tabs,
  activeTab,
  onTabChange,
  onTabClose,
  onTabAdd,
}: ViewportTabsProps) {
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [contextTab, setContextTab] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId === targetId) return;
    // Reorder is handled by the parent via tab ordering.
    // For now we just clear drag state; parent can implement reorder via onTabReorder if needed.
    setDraggedTab(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedTab(null);
  }, []);

  const handleCloseOthers = useCallback(
    (keepId: string) => {
      tabs.forEach((tab) => {
        if (tab.id !== keepId) {
          onTabClose(tab.id);
        }
      });
    },
    [tabs, onTabClose],
  );

  const handleCloseAll = useCallback(() => {
    tabs.forEach((tab) => onTabClose(tab.id));
  }, [tabs, onTabClose]);

  return (
    <div className="flex items-center border-b border-border bg-muted/30 h-9 overflow-hidden">
      <div ref={tabsRef} className="flex items-center flex-1 overflow-x-auto">
        {tabs.map((tab) => (
          <DropdownMenu
            key={tab.id}
            open={contextTab === tab.id}
            onOpenChange={(open) => !open && setContextTab(null)}
          >
            <DropdownMenuTrigger asChild>
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, tab.id)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextTab(tab.id);
                }}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "group relative flex items-center gap-1.5 px-3 h-9 text-xs cursor-pointer select-none border-r border-border shrink-0",
                  tab.id === activeTab
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-background/50",
                  draggedTab === tab.id && "opacity-50",
                )}
              >
                <span className="truncate max-w-[120px]">{tab.filename}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  className={cn(
                    "shrink-0 rounded p-0.5 hover:bg-muted",
                    tab.id === activeTab
                      ? "opacity-60 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
                  )}
                >
                  <IconX className="w-3 h-3" />
                </button>
                {/* Active indicator */}
                {tab.id === activeTab && (
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => onTabClose(tab.id)}>
                Close
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCloseOthers(tab.id)}>
                Close Others
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCloseAll}>
                Close All
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-none"
        onClick={onTabAdd}
      >
        <IconPlus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
