import { IconFile, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export interface OpenTab {
  path: string;
  dirty: boolean;
}

interface FileTabsProps {
  tabs: OpenTab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

/**
 * Open-file tab strip across the top of the editor pane. Each tab shows
 * the file's leaf name, with a small dirty dot when the file has
 * unsaved changes. Closing a tab is the X button (or middle-click, but
 * the X is the discoverable affordance).
 */
export function FileTabs({
  tabs,
  activePath,
  onActivate,
  onClose,
}: FileTabsProps) {
  if (tabs.length === 0) {
    return <div className="h-8 shrink-0 border-b border-border bg-muted/20" />;
  }
  return (
    <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/20">
      {tabs.map((tab) => (
        <Tab
          key={tab.path}
          tab={tab}
          active={tab.path === activePath}
          onActivate={() => onActivate(tab.path)}
          onClose={() => onClose(tab.path)}
        />
      ))}
    </div>
  );
}

function Tab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: OpenTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const leaf = tab.path.split("/").slice(-1)[0] || tab.path;
  return (
    <div
      className={cn(
        "group flex shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-xs",
        active
          ? "bg-background text-foreground"
          : "bg-muted/20 text-muted-foreground hover:bg-background/50",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex cursor-pointer items-center gap-1.5 py-1"
        title={tab.path}
      >
        <IconFile size={12} aria-hidden className="text-muted-foreground" />
        <span className="truncate max-w-[180px]">{leaf}</span>
        {tab.dirty ? (
          <span
            aria-label="Unsaved changes"
            className="size-1.5 rounded-full bg-foreground"
          />
        ) : null}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
        aria-label={`Close ${leaf}`}
      >
        <IconX size={10} aria-hidden />
      </button>
    </div>
  );
}
