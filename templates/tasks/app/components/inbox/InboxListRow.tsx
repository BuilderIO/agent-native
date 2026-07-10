import { useState } from "react";
import { IconChecks, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { InlineEditable } from "@/components/shared/InlineEditable";
import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import { ListRow } from "@/components/shared/list/ListRow";
import { ListRowDragHandle } from "@/components/shared/list/ListRowDragHandle";
import type { ListSelection } from "@/components/shared/selection/use-list-selection";

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

          {rowSelection.selectionMode ? (
            <Checkbox
              checked={rowSelection.selected}
              onClick={rowSelection.selectRow}
              className="cursor-pointer"
              aria-label={`Select ${displayTitle}`}
            />
          ) : null}

          <div className="min-w-0 flex-1">
            {rowSelection.selectionMode ? (
              <div className="flex h-8 min-w-0 items-center truncate text-sm font-medium">
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

          {!rowSelection.selectionMode ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void handleMarkReady()}
              >
                Mark ready
              </Button>

              <RowActionsMenu
                ariaLabel={`Actions for ${displayTitle}`}
                disabled={busy}
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
          ) : null}
        </>
      )}
    </ListRow>
  );
}
