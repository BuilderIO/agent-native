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
      aria-live="polite"
      className="flex w-fit max-w-full items-center gap-0.5 rounded-lg bg-foreground/95 px-2 py-1.5 text-background shadow-2xl ring-1 ring-background/15 backdrop-blur-md dark:bg-background/95 dark:text-foreground dark:ring-foreground/15"
    >
      <span className="whitespace-nowrap px-2 text-xs font-semibold tabular-nums">
        {t("clipsFinalRaw.selectedCount", { count })}
      </span>
      {onSelectAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-background hover:bg-background/15 hover:text-background dark:text-foreground dark:hover:bg-foreground/10 dark:hover:text-foreground"
          onClick={onSelectAll}
          disabled={isPending}
        >
          {allSelected
            ? t("clipsFinalRaw.deselectAll")
            : t("clipsFinalRaw.selectAll")}
        </Button>
      )}
      <div className="mx-1 h-5 w-px bg-background/20 dark:bg-foreground/20" />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2.5 text-background hover:bg-background/15 hover:text-background dark:text-foreground dark:hover:bg-foreground/10 dark:hover:text-foreground"
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
              className="h-8 gap-1.5 px-2.5 text-background hover:bg-background/15 hover:text-background dark:text-foreground dark:hover:bg-foreground/10 dark:hover:text-foreground"
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
        className="h-8 gap-1.5 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onTrash}
        disabled={isPending}
      >
        <IconTrash className="h-3.5 w-3.5" /> {t("navigation.trash")}
      </Button>
      <div className="mx-1 h-5 w-px bg-background/20 dark:bg-foreground/20" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClear}
        className="size-8 text-background/70 hover:bg-background/15 hover:text-background dark:text-foreground/70 dark:hover:bg-foreground/10 dark:hover:text-foreground"
        aria-label={t("clipsFinalRaw.clearSelection")}
      >
        <IconX className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
