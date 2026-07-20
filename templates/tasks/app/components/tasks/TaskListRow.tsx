import { useT } from "@agent-native/core/client";
import { IconChecks, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { selectColorClass } from "@/components/custom-fields/editor/config/select-colors";
import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import {
  InlineEditable,
  LIST_ROW_TITLE_FIELD_CLASS,
} from "@/components/shared/InlineEditable";
import { ListRow } from "@/components/shared/list/ListRow";
import { ListRowDragHandle } from "@/components/shared/list/ListRowDragHandle";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import type { ListSelection } from "@/components/shared/selection/use-list-selection";
import { useTaskRowCompletionAnimation } from "@/components/tasks/use-task-row-completion-animation";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { TaskFieldValue } from "@/hooks/use-custom-fields";
import {
  TASK_CARD_FIELD_LIMIT,
  useVisibleTaskFieldIds,
} from "@/hooks/use-visible-task-fields";
import { cn } from "@/lib/utils";

import "./TaskListRow.css";

export interface TaskListRowProps {
  sortable: SortableItemRenderProps;
  selection: ListSelection<{ id: string }>;
  item: { id: string; title: string };
  fields?: TaskFieldValue[];
  done?: boolean;
  highlighted?: boolean;
  hideAfterComplete: boolean;
  onOpenDetails: () => void;
  onUpdateTitle: (title: string) => Promise<unknown>;
  onUpdateDone: (done: boolean) => Promise<unknown>;
  onRequestDelete: () => void;
  onBeginExit: () => void;
  onExitAfterComplete: () => void;
}

export function TaskListRow({
  sortable,
  selection,
  item,
  fields,
  done = false,
  highlighted = false,
  hideAfterComplete,
  onOpenDetails,
  onUpdateTitle,
  onUpdateDone,
  onRequestDelete,
  onBeginExit,
  onExitAfterComplete,
}: TaskListRowProps) {
  const t = useT();
  const selected = selection.state.selectedItems.some(
    (entry) => entry.id === item.id,
  );
  const [displayTitle, setDisplayTitle] = useState(item.title);

  const completion = useTaskRowCompletionAnimation({
    taskDone: done,
    hideAfterComplete,
    onBeginExit,
    onExitAfterComplete,
    onUpdateTask: (patch) => onUpdateDone(patch.done),
  });

  if (completion.completionPhase === "exited") {
    return null;
  }

  const displayDone = completion.displayDone;
  const completionPhase = completion.completionPhase;
  const busy = completion.isAnimating;

  return (
    <ListRow
      sortable={sortable}
      item={item}
      itemLabel={displayTitle}
      selection={selection}
      highlighted={highlighted}
      onActivate={onOpenDetails}
      onAnimationEnd={completion.handleRowAnimationEnd}
      dataAttributes={{ "data-task-id": item.id }}
      className={cn(
        "will-change-[opacity,transform]",
        displayDone && completionPhase === "idle" && !selected && "opacity-60",
        completionPhase === "completing" &&
          hideAfterComplete &&
          "task-row-exit opacity-60",
        completionPhase === "completing" &&
          !hideAfterComplete &&
          "task-row-complete opacity-60",
        completionPhase === "uncompleting" && "task-row-restore",
      )}
    >
      {({ rowDrag, rowSelection }) => {
        const selectionTitleClassName = cn(
          LIST_ROW_TITLE_FIELD_CLASS,
          "flex items-center truncate border-transparent bg-transparent text-left text-foreground",
          displayDone && "line-through text-muted-foreground",
          rowSelection.selected && displayDone && "text-foreground/80",
        );

        return (
          <>
            <ListRowDragHandle
              rowDrag={rowDrag}
              rowSelection={rowSelection}
              displayTitle={displayTitle}
              disabled={busy}
            />

            <Checkbox
              checked={displayDone}
              disabled={busy}
              onCheckedChange={completion.handleDoneToggle}
              onClick={
                rowSelection.selectionMode ? rowSelection.selectRow : undefined
              }
              aria-label={
                displayDone
                  ? t("tasks.markIncompleteAriaLabel", { title: displayTitle })
                  : t("tasks.markCompleteAriaLabel", { title: displayTitle })
              }
            />

            <div className="min-w-0 flex-1">
              {rowSelection.selectionMode ? (
                <div className={selectionTitleClassName}>{displayTitle}</div>
              ) : (
                <InlineEditable
                  value={item.title}
                  onSave={onUpdateTitle}
                  onDisplayTitleChange={setDisplayTitle}
                  ariaLabel={t("common.editTitleAriaLabel")}
                  disabled={busy}
                  titleDragProps={rowDrag.titleDragProps}
                  displayDone={displayDone}
                />
              )}
              <div className="min-w-0 md:hidden">
                <TaskListRowFieldBadges fields={fields} />
              </div>
            </div>

            <div className="hidden min-w-0 shrink-0 md:block">
              <TaskListRowFieldStrip fields={fields} />
            </div>

            <RowActionsMenu
              ariaLabel={t("common.rowActionsAriaLabel", {
                title: displayTitle,
              })}
              disabled={busy || rowSelection.selectionMode}
            >
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => selection.actions.startSelection(item.id)}
              >
                <IconChecks className="size-4" />
                {t("selection.select")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-destructive focus:bg-destructive focus:text-destructive-foreground"
                onSelect={onRequestDelete}
              >
                <IconTrash className="size-4" />
                {t("common.delete")}
              </DropdownMenuItem>
            </RowActionsMenu>
          </>
        );
      }}
    </ListRow>
  );
}

function TaskListRowFieldBadges({ fields }: { fields?: TaskFieldValue[] }) {
  const { fieldIds } = useVisibleTaskFieldIds();
  const visible = taskCardDisplayFields(fieldIds, fields).filter(
    (item) => item.value,
  );
  if (visible.length === 0) return null;

  return (
    <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
      {visible.map((item) => (
        <Badge
          key={item.id}
          variant="secondary"
          className="max-w-48 gap-1.5 px-1.5 py-0 text-xs font-normal"
          title={`${item.title}: ${item.value}`}
        >
          <span
            className={cn("size-1.5 shrink-0 rounded-full", item.colorClass)}
          />
          <span className="truncate">
            {item.title}: {item.value}
          </span>
        </Badge>
      ))}
    </div>
  );
}

function TaskListRowFieldStrip({ fields }: { fields?: TaskFieldValue[] }) {
  const t = useT();
  const { fieldIds } = useVisibleTaskFieldIds();
  const items = taskCardDisplayFields(fieldIds, fields);
  const columnCount = Math.min(fieldIds.length, TASK_CARD_FIELD_LIMIT);

  return (
    <div
      className="grid items-center gap-2 text-xs"
      style={{
        gridTemplateColumns: `repeat(${columnCount}, minmax(6.5rem, 8rem))`,
      }}
      aria-label={t("tasks.visibleTaskFieldsAriaLabel")}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-muted-foreground",
            item.value && "bg-muted/45 text-foreground",
          )}
          title={item.value ? `${item.title}: ${item.value}` : item.title}
        >
          {item.value ? (
            <span
              className={cn("size-1.5 shrink-0 rounded-full", item.colorClass)}
            />
          ) : null}
          <span className="truncate">{item.value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

type TaskCardDisplayField = {
  id: string;
  title: string;
  value: string | null;
  colorClass: string;
};

function taskCardDisplayFields(
  fieldIds: readonly string[],
  fields?: TaskFieldValue[],
): TaskCardDisplayField[] {
  return fieldIds.slice(0, TASK_CARD_FIELD_LIMIT).map((fieldId) => {
    const field = fields?.find((candidate) => candidate.id === fieldId);
    return {
      id: fieldId,
      title: field?.title ?? fieldId,
      value: field ? formatTaskFieldDisplayValue(field) : null,
      colorClass: taskFieldDisplayDotClass(field),
    };
  });
}

function optionById(field: TaskFieldValue, optionId: string) {
  const options = "options" in field.config ? field.config.options : [];
  return options.find((option) => option.id === optionId);
}

function formatTaskFieldDisplayValue(field: TaskFieldValue) {
  const { value } = field;
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  if (field.type === "currency" && typeof value === "number") {
    return `${field.config.symbol}${value.toFixed(field.config.precision ?? 2)}`;
  }

  if (field.type === "percent" && typeof value === "number") {
    return `${value}%`;
  }

  if (typeof value === "number") {
    return value.toLocaleString(undefined, {
      maximumFractionDigits:
        field.type === "number" ? (field.config.precision ?? 6) : 6,
    });
  }

  if (field.type === "single_select" && typeof value === "string") {
    return optionById(field, value)?.name ?? null;
  }

  if (field.type === "multi_select" && Array.isArray(value)) {
    return value
      .map((optionId) => optionById(field, optionId)?.name)
      .filter(Boolean)
      .join(", ");
  }

  return typeof value === "string" ? value : null;
}

function taskFieldDisplayDotClass(field?: TaskFieldValue) {
  if (!field) return "bg-muted-foreground/30";
  if (field.type === "single_select" && typeof field.value === "string") {
    return selectColorClass(optionById(field, field.value)?.color);
  }
  return "bg-muted-foreground/40";
}
