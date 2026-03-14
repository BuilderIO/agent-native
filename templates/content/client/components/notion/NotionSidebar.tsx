import { NotionSyncPanel } from "./NotionSyncPanel";
import { X } from "lucide-react";

interface NotionSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  markdown: string;
  onChange: (markdown: string) => void;
  projectSlug: string;
  filePath: string;
  localUpdatedAt?: string;
  onSyncStatusChange?: (status: 'idle' | 'syncing' | 'synced') => void;
}

export function NotionSidebar({
  open,
  onOpenChange,
  markdown,
  onChange,
  projectSlug,
  filePath,
  localUpdatedAt,
  onSyncStatusChange,
}: NotionSidebarProps) {
  // Always mount NotionSyncPanel so auto-sync hooks run even when sidebar is closed.
  // When !open, render it hidden (autoSyncOnly mode returns null from the panel itself).
  if (!open) {
    return (
      <NotionSyncPanel
        markdown={markdown}
        onChange={onChange}
        projectSlug={projectSlug}
        onSyncStatusChange={onSyncStatusChange}
        autoSyncOnly
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-background w-full z-10">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-muted/30">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                 <path d="M4.459 4.208c.746-.575 1.944-.803 3.528-.803h7.933c1.551 0 2.721.242 3.468.803.778.591.95 1.636.95 3.328v9.063c0 1.659-.16 2.686-.92 3.264-.734.56-1.905.787-3.467.787H8.02c-1.583 0-2.776-.231-3.528-.787-.775-.578-.934-1.61-.934-3.264V7.536c0-1.684.174-2.73.896-3.328h.005zm14.155 3.197H5.21v9.231h13.404V7.405zm-6.611 1.958h1.492v5.184h-1.492V9.363zm-3.498 0h1.492v5.184H8.505V9.363z"/>
              </svg>
              Notion Sync
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <NotionSyncPanel
              markdown={markdown}
              onChange={onChange}
              projectSlug={projectSlug}
              onSyncStatusChange={onSyncStatusChange}
            />
          </div>
    </div>
  );
}
