import { IconChecks, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import {
  InlineEditable,
  LIST_ROW_TITLE_FIELD_CLASS,
} from "@/components/shared/InlineEditable";
import { ListRow } from "@/components/shared/list/ListRow";
import { ListRowDragHandle } from "@/components/shared/list/ListRowDragHandle";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import type { ListSelection } from "@/components/shared/selection/use-list-selection";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface InboxListRowProps {
  sortable: SortableItemRenderProps;
  selection: ListSelection<{ id: string }>;
  item: { id: string; title: string };
  highlighted?: boolean;
  onUpdateTitle: (title: string) => Promise<unknown>;
  onRequestDelete: () => void;
  onMarkReady: () => Promise<unknown>;
}

export function InboxListRow({
  sortable,
  selection,
  item,
  highlighted = false,
  onUpdateTitle,
  onRequestDelete,
  onMarkReady,
}: InboxListRowProps) {
  const [displayTitle, setDisplayTitle] = useState(item.title);
  const [markReadyPending, setMarkReadyPending] = useState(false);
  const busy = markReadyPending;

  async function handleMarkReady() {
    setMarkReadyPending(true);
    try {
      await onMarkReady();
    } catch {
      setMarkReadyPending(false);
    }
  }

  return (
    <ListRow
      sortable={sortable}
      item={item}
      itemLabel={displayTitle}
      selection={selection}
      highlighted={highlighted}
      dataAttributes={{ "data-inbox-item-id": item.id }}
    >
      {({ rowDrag, rowSelection }) => (
        <>
          <ListRowDragHandle
            rowDrag={rowDrag}
            rowSelection={rowSelection}
            displayTitle={displayTitle}
            disabled={busy}
          />

          <div className="min-w-0 flex-1">
            {rowSelection.selectionMode ? (
              <div
                className={cn(
                  LIST_ROW_TITLE_FIELD_CLASS,
                  "flex items-center truncate border-transparent bg-transparent text-left",
                )}
              >
                {displayTitle}
              </div>
            ) : (
              <InlineEditable
                value={item.title}
                onSave={onUpdateTitle}
                onDisplayTitleChange={setDisplayTitle}
                ariaLabel="Edit title"
                disabled={busy}
                titleDragProps={rowDrag.titleDragProps}
              />
            )}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || rowSelection.selectionMode}
            onClick={() => void handleMarkReady()}
          >
            Mark ready
          </Button>

          <RowActionsMenu
            ariaLabel={`Actions for ${displayTitle}`}
            disabled={busy || rowSelection.selectionMode}
          >
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => selection.actions.startSelection(item.id)}
            >
              <IconChecks className="size-4" />
              Select
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-destructive focus:bg-destructive focus:text-destructive-foreground"
              onSelect={onRequestDelete}
            >
              <IconTrash className="size-4" />
              Delete
            </DropdownMenuItem>
          </RowActionsMenu>
        </>
      )}
    </ListRow>
  );
}
