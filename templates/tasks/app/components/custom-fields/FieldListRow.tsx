import { IconTrash } from "@tabler/icons-react";

import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import { ListRow } from "@/components/shared/list/ListRow";
import { ListRowDragHandle } from "@/components/shared/list/ListRowDragHandle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FieldDefinition, FieldType } from "@/hooks/use-custom-fields";

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  rich_text: "Rich text",
  number: "Number",
  percent: "Percent",
  currency: "Currency",
  single_select: "Single-select",
  multi_select: "Multi-select",
  date: "Date",
};

function fieldTypeLabel(type: FieldType) {
  return FIELD_TYPE_LABELS[type] ?? type;
}

function fieldDescription(field: FieldDefinition) {
  if (field.type === "currency") return `Currency ${field.config.symbol}`;
  if (field.type === "number") {
    const parts: string[] = [];
    parts.push(`${field.config.precision ?? 0} decimals`);
    if (field.config.positiveOnly) parts.push("positive only");
    return parts.join(" · ");
  }
  if (field.type === "percent") {
    return `${field.config.precision ?? 0} decimals`;
  }
  if (field.type === "single_select" || field.type === "multi_select") {
    const options = "options" in field.config ? field.config.options : [];
    return `${options.length} options`;
  }
  return fieldTypeLabel(field.type);
}

function FieldRowMetadata({ field }: { field: FieldDefinition }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
        {fieldTypeLabel(field.type)}
      </Badge>
      <span className="truncate text-xs text-muted-foreground">
        {fieldDescription(field)}
      </span>
    </div>
  );
}

export interface FieldListRowProps {
  sortable: SortableItemRenderProps;
  item: FieldDefinition;
  highlighted?: boolean;
  onOpenDetails: () => void;
  onRequestDelete: () => void;
}

export function FieldListRow({
  sortable,
  item,
  highlighted = false,
  onOpenDetails,
  onRequestDelete,
}: FieldListRowProps) {
  return (
    <ListRow
      sortable={sortable}
      item={item}
      itemLabel={item.title}
      highlighted={highlighted}
      onActivate={onOpenDetails}
      dataAttributes={{ "data-field-id": item.id }}
    >
      {({ rowDrag, rowSelection }) => (
        <>
          <ListRowDragHandle
            rowDrag={rowDrag}
            rowSelection={rowSelection}
            displayTitle={item.title}
          />

          <div className="min-w-0 flex-1">
            <div className="flex h-8 min-w-0 items-center truncate text-sm font-medium">
              {item.title}
            </div>
          </div>

          <div className="min-w-0 shrink-0">
            <FieldRowMetadata field={item} />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${item.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete();
            }}
            className="relative z-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <IconTrash />
          </Button>
        </>
      )}
    </ListRow>
  );
}
