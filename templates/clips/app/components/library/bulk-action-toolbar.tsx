import { useT } from "@agent-native/core/client/i18n";
import {
  IconArchive,
  IconFolder,
  IconFolderPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

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
  allSelected?: boolean;
  onSelectAll?: () => void;
  onArchive?: () => void;
  onMove?: (folderId: string | null) => void;
  onTrash?: () => void;
  onClear?: () => void;
  moveTargets?: BulkMoveTarget[];
  isPending?: boolean;
  onCreateFolder?: () => void;
}

export function BulkActionToolbar({
  count,
  allSelected = false,
  onSelectAll,
  onArchive,
  onMove,
  onTrash,
  onClear,
  moveTargets = [],
  isPending = false,
  onCreateFolder,
}: BulkActionToolbarProps) {
  const t = useT();
  if (count === 0) return null;
  const canMove = Boolean(onMove && moveTargets.length > 0);

  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-1 rounded-xl bg-foreground px-3 py-2 text-background shadow-2xl ring-1 ring-black/10 dark:ring-white/10",
      )}
    >
      <span className="pe-2 text-xs font-medium">
        {t("clipsFinalRaw.selectedCount", { count })}
      </span>
      {onSelectAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background"
          onClick={onSelectAll}
          disabled={isPending}
        >
          {allSelected
            ? t("clipsFinalRaw.deselectAll")
            : t("clipsFinalRaw.selectAll")}
        </Button>
      )}
      <div className="h-4 w-px bg-background/20" />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background"
        onClick={onArchive}
        disabled={isPending}
      >
        <IconArchive className="h-3.5 w-3.5" /> {t("navigation.archive")}
      </Button>
      {canMove && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-background hover:bg-background/15 hover:text-background"
              disabled={isPending}
            >
              <IconFolder className="h-3.5 w-3.5" /> {t("clipsFinalRaw.move")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="w-64">
            <DropdownMenuLabel>
              {t("clipsFinalRaw.moveSelected", { count })}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isPending}
              onSelect={() => {
                setTimeout(() => onCreateFolder?.(), 0);
              }}
            >
              <IconFolderPlus className="h-4 w-4 me-2" />
              {t("navigation.newFolder")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {moveTargets.map((target, index) => (
              <DropdownMenuItem
                key={target.id ?? `root-${index}`}
                disabled={target.disabled || isPending}
                onSelect={() => onMove?.(target.id)}
              >
                <span
                  className="truncate"
                  style={{ paddingInlineStart: (target.depth ?? 0) * 12 }}
                >
                  {target.name}
                </span>
                {target.disabled && (
                  <span className="ms-auto text-xs text-muted-foreground">
                    {t("clipsFinalRaw.current")}
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
        className="h-8 gap-1.5 text-red-400 hover:bg-background/15 hover:text-red-400"
        onClick={onTrash}
        disabled={isPending}
      >
        <IconTrash className="h-3.5 w-3.5" /> {t("navigation.trash")}
      </Button>
      <div className="mx-1 h-4 w-px bg-background/20" />
      <button
        type="button"
        onClick={onClear}
        className="rounded p-1 text-background/70 hover:bg-background/15 hover:text-background"
        aria-label={t("clipsFinalRaw.clearSelection")}
      >
        <IconX className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
