import { IconDots, IconGripVertical } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// TODO(shared-dnd): render the live row component in the drag overlay instead of
// this static chrome duplicate once SortableList can mount row previews safely.

interface ListRowPreviewProps {
  id: string;
  title: string;
  overlayDataAttribute: string;
  blockDragCount?: number;
  /** `true` = task list (checkbox); `false` = inbox (Mark ready button). */
  promotedToTask?: boolean;
  checkbox?: {
    checked: boolean;
    ariaLabel?: string;
  };
  dimmed?: boolean;
  titleClassName?: string;
}

export function ListRowPreview({
  id,
  title,
  overlayDataAttribute,
  blockDragCount,
  promotedToTask = true,
  checkbox,
  dimmed = false,
  titleClassName,
}: ListRowPreviewProps) {
  return (
    <div className="relative">
      {blockDragCount && blockDragCount > 1 ? (
        <span
          aria-hidden="true"
          className="absolute -right-2 -top-2 z-10 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-md"
        >
          {blockDragCount}
        </span>
      ) : null}
      <div
        {...{ [overlayDataAttribute]: id }}
        className={cn(
          "pointer-events-none group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-md ring-1 ring-border",
          dimmed && "opacity-60",
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground">
          <IconGripVertical className="size-4" />
        </div>

        {promotedToTask && checkbox ? (
          <Checkbox
            checked={checkbox.checked}
            disabled
            aria-hidden="true"
            aria-label={checkbox.ariaLabel}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex h-8 items-center truncate rounded-md border border-transparent px-3 text-sm leading-8",
              titleClassName,
            )}
          >
            {title}
          </div>
        </div>

        {!promotedToTask ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            aria-hidden="true"
            tabIndex={-1}
          >
            Mark ready
          </Button>
        ) : null}

        <div
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70"
        >
          <IconDots className="size-4" />
        </div>
      </div>
    </div>
  );
}
