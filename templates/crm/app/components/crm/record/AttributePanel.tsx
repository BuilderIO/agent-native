/**
 * The left pane: highlights, then the rest of the object's typed attributes,
 * each inline-editable when `update-crm-record` would actually accept it.
 */

import { ExtensionSlot } from "@agent-native/core/client/extensions";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import type {
  CrmAttributeDefinition,
  CrmValue,
} from "../../../../shared/crm-contract";
import { FieldEditor, FieldLockNote, FieldValueDisplay } from "./field-editors";
import { FieldHistoryButton } from "./FieldHistory";
import {
  fieldEditability,
  splitHighlights,
  type CrmRecordPage,
  type CrmRecordPageValueMeta,
} from "./record-data";

export function AttributePanel({
  page,
  onCommit,
}: {
  page: CrmRecordPage;
  onCommit: (attribute: CrmAttributeDefinition, value: CrmValue) => void;
}) {
  const t = useT();
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const { highlights, rest } = splitHighlights(page.attributes);

  return (
    <aside className="flex min-h-full w-full flex-col gap-6 border-border/70 p-5 lg:w-[22rem] lg:shrink-0 lg:border-r">
      <section aria-labelledby="crm-record-highlights">
        <h2
          id="crm-record-highlights"
          className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
        >
          {t("record.highlights")}
        </h2>
        <div className="mt-3 grid gap-0.5">
          {highlights.length ? (
            highlights.map((attribute) => (
              <AttributeRow
                key={attribute.id}
                recordId={page.record.id}
                attribute={attribute}
                value={page.values[attribute.apiSlug]}
                meta={page.valueMeta[attribute.apiSlug]}
                isEditing={editingSlug === attribute.apiSlug}
                onStartEdit={() => setEditingSlug(attribute.apiSlug)}
                onDone={() => setEditingSlug(null)}
                onCommit={(value) => onCommit(attribute, value)}
              />
            ))
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              {t("record.noAttributes")}
            </p>
          )}
        </div>
      </section>

      {rest.length ? (
        <details open className="group/details">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <IconChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
            {t("record.allAttributes")}
          </summary>
          <div className="mt-3 grid gap-0.5">
            {rest.map((attribute) => (
              <AttributeRow
                key={attribute.id}
                recordId={page.record.id}
                attribute={attribute}
                value={page.values[attribute.apiSlug]}
                meta={page.valueMeta[attribute.apiSlug]}
                isEditing={editingSlug === attribute.apiSlug}
                onStartEdit={() => setEditingSlug(attribute.apiSlug)}
                onDone={() => setEditingSlug(null)}
                onCommit={(value) => onCommit(attribute, value)}
              />
            ))}
          </div>
        </details>
      ) : null}

      {/* Stable extension contract: changing this slot id or context is a migration. */}
      <ExtensionSlot
        id="crm.record-sidebar.bottom"
        context={{
          recordId: page.record.id,
          objectType: page.record.objectType,
          kind: page.record.kind,
          displayName: page.record.displayName,
          provider: page.record.provider,
          values: page.values,
        }}
      />
    </aside>
  );
}

function AttributeRow({
  recordId,
  attribute,
  value,
  meta,
  isEditing,
  onStartEdit,
  onDone,
  onCommit,
}: {
  recordId: string;
  attribute: CrmAttributeDefinition;
  value: CrmValue | undefined;
  meta: CrmRecordPageValueMeta | undefined;
  isEditing: boolean;
  onStartEdit: () => void;
  onDone: () => void;
  onCommit: (value: CrmValue) => void;
}) {
  const t = useT();
  const editability = fieldEditability(attribute);
  // Options and checkboxes are always live controls; typing controls swap in
  // only once the row is activated, so the panel stays readable at rest.
  const alwaysLive =
    editability.editable &&
    (attribute.attributeType === "checkbox" ||
      (!attribute.multi &&
        (attribute.attributeType === "status" ||
          attribute.attributeType === "select")));

  return (
    <div className="group grid grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <div className="flex min-w-0 items-center gap-1 pt-1">
        <span
          className="truncate text-sm text-muted-foreground"
          title={attribute.description ?? attribute.label}
        >
          {attribute.label}
        </span>
        {attribute.historyTracked ? (
          <FieldHistoryButton recordId={recordId} attribute={attribute} />
        ) : null}
      </div>
      <div className="min-w-0 text-sm">
        {alwaysLive || isEditing ? (
          <FieldEditor
            attribute={attribute}
            value={value}
            autoFocus={isEditing}
            onCommit={onCommit}
            onDone={onDone}
          />
        ) : editability.editable ? (
          <button
            type="button"
            className="w-full cursor-pointer rounded px-1 py-1 text-left hover:bg-background"
            onClick={onStartEdit}
          >
            <FieldValueDisplay attribute={attribute} value={value} />
          </button>
        ) : (
          <div className="grid gap-1 px-1 py-1">
            <FieldValueDisplay attribute={attribute} value={value} />
            <FieldLockNote reason={editability.reason} />
          </div>
        )}
        {meta && !isEditing ? (
          <p className="mt-0.5 px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            {t("record.lastSetBy", {
              actor: meta.actorId ?? meta.actorType,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
