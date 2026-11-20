import { ChevronDownIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// One grid for Pages, Layers and the Library: 32px rows padded 16px inline,
// 24px per level, then a 16px chevron slot, 8px, a 16px icon slot, 8px and the
// label. A level is exactly chevron + gap wide, so a child's chevron sits
// under its parent's icon, and a section head's chevron sits on depth 0's.
export const TREE_GRID_ROW_CLASS =
  "flex h-[var(--design-row-height)] min-w-0 items-center px-4 text-xs leading-4";

export const TREE_GRID_ICON_SLOT_CLASS =
  "flex size-4 shrink-0 items-center justify-center";

/**
 * The indent and chevron columns that start every row. `fit` lets the indents
 * shrink so a deep row keeps room for its name in a narrow panel.
 */
export function TreeGridLead({
  depth,
  chevron,
  chevronSlot = true,
  fit = false,
}: {
  depth: number;
  chevron?: ReactNode;
  /** The drop indicator lines up with the chevron column, so it omits it. */
  chevronSlot?: boolean;
  fit?: boolean;
}) {
  return (
    <span
      data-layer-row-indents
      className={cn("flex h-full items-center", fit ? "min-w-0" : "shrink-0")}
      aria-hidden={chevron ? undefined : true}
    >
      {Array.from({ length: depth }, (_, index) => (
        <span
          key={index}
          data-layer-row-indent
          className={cn("h-full w-6", fit ? "min-w-0 shrink" : "shrink-0")}
        />
      ))}
      {chevronSlot ? (
        <span
          data-tree-row-chevron-slot
          className={cn(TREE_GRID_ICON_SLOT_CLASS, "me-2")}
        >
          {chevron}
        </span>
      ) : null}
    </span>
  );
}

export function TreeGridChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        "design-ui-icon text-muted-foreground",
        !expanded && "-rotate-90 rtl:rotate-90",
      )}
    />
  );
}

/**
 * A 40px section head (Pages, Layers) whose chevron sits on the rows' chevron
 * column. It sticks to the top of the list it heads.
 */
export function TreeGridSectionHead({
  label,
  expanded,
  onExpandedChange,
  actions,
  className,
  headerId,
}: {
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  actions?: ReactNode;
  className?: string;
  /** Rendered as `data-layers-panel-header` for tests and chrome geometry. */
  headerId?: string;
}) {
  return (
    <div
      data-layers-panel-header={headerId}
      className={cn(
        "sticky top-0 z-[1] flex h-[var(--design-section-height)] shrink-0 items-center bg-[var(--design-editor-panel-bg)] pe-2",
        className,
      )}
    >
      <h2 className="flex h-full min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={expanded}
          data-tree-section-toggle
          className="flex h-full min-w-0 flex-1 cursor-default items-center ps-4 text-start text-xs font-[550] leading-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--design-focus-ring-color)]"
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className={cn(TREE_GRID_ICON_SLOT_CLASS, "me-2")}>
            <TreeGridChevron expanded={expanded} />
          </span>
          <span className="truncate">{label}</span>
        </button>
      </h2>
      {actions ? (
        <div className="flex shrink-0 items-center text-muted-foreground">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
