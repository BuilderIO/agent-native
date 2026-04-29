import {
  IconFolder,
  IconUsersGroup,
  IconTag,
  IconArchive,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BulkActionToolbarProps {
  count: number;
  onMove?: () => void;
  onAddToSpace?: () => void;
  onTag?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  onClear?: () => void;
  isPending?: boolean;
}

export function BulkActionToolbar({
  count,
  onMove,
  onAddToSpace,
  onTag,
  onArchive,
  onTrash,
  onClear,
  isPending = false,
}: BulkActionToolbarProps) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "sticky bottom-4 mx-auto z-30 flex items-center gap-1 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg",
        "w-fit",
      )}
    >
      <span className="pr-2 text-xs font-medium text-foreground">
        {count} selected
      </span>
      <div className="h-4 w-px bg-border" />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onMove}
      >
        <IconFolder className="h-3.5 w-3.5" /> Move
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onAddToSpace}
      >
        <IconUsersGroup className="h-3.5 w-3.5" /> Space
      </Button>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onTag}>
        <IconTag className="h-3.5 w-3.5" /> Tag
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onArchive}
        disabled={isPending}
      >
        <IconArchive className="h-3.5 w-3.5" /> Archive
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-destructive hover:text-destructive"
        onClick={onTrash}
        disabled={isPending}
      >
        <IconTrash className="h-3.5 w-3.5" /> Trash
      </Button>
      <div className="h-4 w-px bg-border mx-1" />
      <button
        type="button"
        onClick={onClear}
        className="rounded p-1 text-muted-foreground hover:bg-accent"
        aria-label="Clear selection"
      >
        <IconX className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
