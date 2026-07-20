import { focusAgentChat, useT } from "@agent-native/core/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FieldListRow } from "@/components/custom-fields/FieldListRow";
import { FieldsListSkeleton } from "@/components/custom-fields/FieldsListSkeleton";
import { INERT_SORTABLE_PROPS } from "@/components/dnd/SortableItem";
import { ChipSelect } from "@/components/shared/ChipSelect";
import { DeleteItemDialog } from "@/components/shared/DeleteItemDialog";
import { ListRowPreview } from "@/components/shared/dnd/ListRowPreview";
import { List } from "@/components/shared/list/List";
import { ListEmptyState } from "@/components/shared/ListEmptyState";
import { ListErrorMessage } from "@/components/shared/ListErrorMessage";
import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
  useReorderCustomFields,
  type FieldDefinition,
} from "@/hooks/use-custom-fields";
import {
  TASK_CARD_FIELD_LIMIT,
  useUpdateVisibleTaskFields,
  useVisibleTaskFieldIds,
} from "@/hooks/use-visible-task-fields";

import { FieldEditorSidebar } from "./editor/FieldEditorSidebar";
import type { FieldDraft } from "./editor/types";
import { FieldCreateBar } from "./FieldCreateBar";

type FieldListItem = FieldDefinition;

export function FieldsList({
  activeFieldId,
  setActiveFieldId,
}: {
  activeFieldId: string | null;
  setActiveFieldId: (fieldId: string | null) => void;
}) {
  const t = useT();
  const { fields, isPending, isError, error } = useCustomFields();
  const { fieldIds: visibleFieldIds } = useVisibleTaskFieldIds();
  const updateVisibleTaskFields = useUpdateVisibleTaskFields();
  const visibleFieldOptions = useMemo(
    () => fields.map((field) => ({ id: field.id, label: field.title })),
    [fields],
  );
  const createField = useCreateCustomField();
  const deleteField = useDeleteCustomField();
  const reorderFields = useReorderCustomFields();
  const listItems = useMemo<FieldListItem[]>(() => fields, [fields]);
  const [orderedFields, setOrderedFields] =
    useState<FieldListItem[]>(listItems);
  const [pendingDelete, setPendingDelete] = useState<FieldDefinition | null>(
    null,
  );
  const busy =
    createField.isPending || deleteField.isPending || reorderFields.isPending;
  const editingField = activeFieldId
    ? (fields.find((field) => field.id === activeFieldId) ?? null)
    : null;

  useEffect(() => {
    setOrderedFields(listItems);
  }, [listItems]);

  useEffect(() => {
    if (!activeFieldId) return;
    if (!fields.some((field) => field.id === activeFieldId)) {
      setActiveFieldId(null);
    }
  }, [activeFieldId, fields, setActiveFieldId]);

  async function handleCreate(draft: FieldDraft) {
    try {
      const created = await createField.mutateAsync({
        title: draft.title,
        type: draft.type,
        config: draft.config,
      });
      setActiveFieldId(created.id);
      focusAgentChat();
      toast.success(t("fields.createdToast"));
    } catch (caught) {
      toast.error((caught as Error)?.message ?? t("fields.createError"));
      throw caught;
    }
  }

  async function handleDelete() {
    const field = pendingDelete;
    if (!field) return;
    try {
      const result = await deleteField.mutateAsync({ fieldId: field.id });
      setPendingDelete(null);
      if (activeFieldId === field.id) setActiveFieldId(null);
      toast.success(
        result.deletedValues
          ? t("fields.deletedWithValuesToast", {
              title: field.title,
              count: result.deletedValues,
            })
          : t("fields.deletedToast", { title: field.title }),
      );
    } catch (caught) {
      toast.error((caught as Error)?.message ?? t("fields.deleteError"));
    }
  }

  const openEditor = useCallback(
    (fieldId: string) => {
      focusAgentChat();
      setActiveFieldId(fieldId);
    },
    [setActiveFieldId],
  );

  function handleReorder(nextFields: FieldListItem[]) {
    setOrderedFields(nextFields);
    reorderFields.mutate(
      { fieldIds: nextFields.map((field) => field.id) },
      { onError: () => setOrderedFields(listItems) },
    );
  }

  return (
    <>
      <div className="grid shrink-0 gap-3">
        <FieldCreateBar busy={busy} onCreate={handleCreate} />
        <ChipSelect
          label={t("fields.taskCardFieldsLabel")}
          options={visibleFieldOptions}
          selectedIds={visibleFieldIds}
          onSelectedIdsChange={(fieldIds) =>
            updateVisibleTaskFields.mutate({ fieldIds })
          }
          disabled={busy || isPending || updateVisibleTaskFields.isPending}
          limit={TASK_CARD_FIELD_LIMIT}
          addButtonLabel={t("fields.addFieldButtonLabel")}
          emptyLabel={t("fields.noFieldsSelectedLabel")}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isPending ? (
          <FieldsListSkeleton />
        ) : isError ? (
          <div
            aria-label={t("fields.listAriaLabel")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
          >
            <ListErrorMessage
              error={error}
              fallbackMessage={t("fields.loadError")}
            />
          </div>
        ) : orderedFields.length === 0 ? (
          <div
            aria-label={t("fields.listAriaLabel")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
          >
            <ListEmptyState
              heading={t("fields.emptyHeading")}
              description={t("fields.emptyDescription")}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none">
            <List
              items={orderedFields}
              selectionEnabled={false}
              ariaLabel={t("fields.listAriaLabel")}
              onReorder={handleReorder}
              renderItem={({ item, sortable }) => (
                <FieldListRow
                  sortable={sortable}
                  item={item}
                  highlighted={activeFieldId === item.id}
                  onOpenDetails={() => openEditor(item.id)}
                  onRequestDelete={() => setPendingDelete(item)}
                />
              )}
              renderOverlay={({ item, blockDragCount }) => (
                <ListRowPreview
                  id={item.id}
                  overlayDataAttribute="data-dnd-overlay-field-id"
                  blockDragCount={blockDragCount}
                >
                  <FieldListRow
                    sortable={INERT_SORTABLE_PROPS}
                    item={item}
                    highlighted={activeFieldId === item.id}
                    onOpenDetails={() => openEditor(item.id)}
                    onRequestDelete={() => setPendingDelete(item)}
                  />
                </ListRowPreview>
              )}
            />
          </div>
        )}

        <DeleteItemDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          entityLabel={t("fields.entitySingular")}
          itemTitle={pendingDelete?.title ?? null}
          pending={deleteField.isPending}
          description={
            pendingDelete
              ? t("fields.deleteFieldDescriptionWithTitle", {
                  title: pendingDelete.title,
                })
              : t("fields.deleteFieldDescription")
          }
          onConfirm={() => void handleDelete()}
        />
      </div>

      <FieldEditorSidebar
        field={editingField}
        disabled={deleteField.isPending}
        onClose={() => setActiveFieldId(null)}
      />
    </>
  );
}
