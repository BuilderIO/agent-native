import { IconArchive, IconFolder, IconTrash, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface BulkMoveTarget {
  id: string | null;
  name: string;
  depth?: number;
  disabled?: boolean;
}

interface BulkActionToolbarProps {
  count: number;
  onArchive?: () => void;
  onMove?: (folderId: string | null) => void;
  onTrash?: () => void;
  onClear?: () => void;
  moveTargets?: BulkMoveTarget[];
  isPending?: boolean;
}

export function BulkActionToolbar({
  count,
  onArchive,
  onMove,
  onTrash,
  onClear,
  moveTargets = [],
  isPending = false,
}: BulkActionToolbarProps) {
  if (count === 0) return null;
  const canMove = Boolean(onMove && moveTargets.length > 0);

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
        onClick={onArchive}
        disabled={isPending}
      >
        <IconArchive className="h-3.5 w-3.5" /> Archive
      </Button>
      {canMove && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              disabled={isPending}
            >
              <IconFolder className="h-3.5 w-3.5" /> Move
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="w-64">
            <DropdownMenuLabel>Move {count} selected</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {moveTargets.map((target, index) => (
              <DropdownMenuItem
                key={target.id ?? `root-${index}`}
                disabled={target.disabled || isPending}
                onSelect={() => onMove?.(target.id)}
              >
                <span
                  className="truncate"
                  style={{ paddingLeft: (target.depth ?? 0) * 12 }}
                >
                  {target.name}
                </span>
                {target.disabled && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Current
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
