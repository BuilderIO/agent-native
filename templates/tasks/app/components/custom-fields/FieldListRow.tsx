import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";

import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import { ListRow } from "@/components/shared/list/ListRow";
import { ListRowDragHandle } from "@/components/shared/list/ListRowDragHandle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FieldDefinition, FieldType } from "@/hooks/use-custom-fields";

import { FIELD_TYPE_LABEL_KEYS } from "./field-types";

type Translate = ReturnType<typeof useT>;

function fieldTypeLabel(t: Translate, type: FieldType) {
  const key = FIELD_TYPE_LABEL_KEYS[type];
  return key ? t(key) : type;
}

function fieldDescription(t: Translate, field: FieldDefinition) {
  if (field.type === "currency") {
    return t("fields.currencyDescription", { symbol: field.config.symbol });
  }
  if (field.type === "number") {
    const parts: string[] = [];
    parts.push(
      t("fields.decimalsDescription", { count: field.config.precision ?? 0 }),
    );
    if (field.config.positiveOnly) parts.push(t("fields.positiveOnlySuffix"));
    return parts.join(" · ");
  }
  if (field.type === "percent") {
    return t("fields.decimalsDescription", {
      count: field.config.precision ?? 0,
    });
  }
  if (field.type === "single_select" || field.type === "multi_select") {
    const options = "options" in field.config ? field.config.options : [];
    return t("fields.optionsCountDescription", { count: options.length });
  }
  return fieldTypeLabel(t, field.type);
}

function FieldRowMetadata({ field }: { field: FieldDefinition }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <Badge variant="secondary" className="px-1.5 py-0 text-xs font-normal">
        {fieldTypeLabel(t, field.type)}
      </Badge>
      <span className="truncate text-xs text-muted-foreground">
        {fieldDescription(t, field)}
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
  const t = useT();
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
            size="icon"
            aria-label={t("fields.deleteFieldAriaLabel", {
              title: item.title,
            })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete();
            }}
            className="relative z-10 size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <IconTrash />
          </Button>
        </>
      )}
    </ListRow>
  );
}
