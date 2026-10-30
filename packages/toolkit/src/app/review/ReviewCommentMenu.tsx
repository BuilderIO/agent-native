import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { cn } from "@agent-native/toolkit/utils";
import { IconDots } from "@tabler/icons-react";
import { useRef } from "react";

import { ReviewTooltip } from "./ReviewTooltip.js";

export interface ReviewCommentMenuProps {
  /** Each item renders only when its handler is passed. */
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  /** The tooltip text. */
  moreActionsLabel?: string | undefined;
  /** Names the button for assistive tech when it must say whose comment it is. */
  ariaLabel?: string | undefined;
  editLabel?: string | undefined;
  deleteLabel?: string | undefined;
  /** Class names for the trigger button. */
  className?: string | undefined;
}

const ITEM_CLASS = "h-7 whitespace-nowrap px-2 py-1 text-sm";

/** The `...` at the end of one comment's header; the thread has its own. */
export function ReviewCommentMenu({
  onEdit,
  onDelete,
  moreActionsLabel = "More actions",
  ariaLabel = moreActionsLabel,
  editLabel = "Edit comment",
  deleteLabel = "Delete comment",
  className,
}: ReviewCommentMenuProps) {
  const editChosenRef = useRef(false);
  if (!onEdit && !onDelete) return null;
  return (
    <DropdownMenu>
      <ReviewTooltip label={moreActionsLabel}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 shrink-0 rounded-[8px] text-muted-foreground hover:text-foreground",
              className,
            )}
            aria-label={ariaLabel}
          >
            <IconDots className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ReviewTooltip>
      <DropdownMenuContent
        data-review-popover=""
        align="end"
        className="w-max min-w-[160px] p-1"
        onCloseAutoFocus={(event) => {
          // Edit puts focus in its composer; leave it there.
          if (editChosenRef.current) event.preventDefault();
          editChosenRef.current = false;
        }}
      >
        {onEdit ? (
          <DropdownMenuItem
            className={ITEM_CLASS}
            onSelect={() => {
              editChosenRef.current = true;
              onEdit();
            }}
          >
            {editLabel}
          </DropdownMenuItem>
        ) : null}
        {onEdit && onDelete ? (
          <DropdownMenuSeparator className="-mx-1 my-1" />
        ) : null}
        {onDelete ? (
          <DropdownMenuItem
            className={cn(
              ITEM_CLASS,
              "text-destructive focus:text-destructive",
            )}
            onSelect={onDelete}
          >
            {deleteLabel}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
