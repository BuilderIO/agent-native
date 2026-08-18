/**
 * Highlights, then the rest of the object's typed attributes, each
 * inline-editable when `update-crm-record` would actually accept it.
 *
 * This renders the *sections*; the resizable pane that holds them (and the
 * list memberships below them) belongs to `RecordWorkspace`.
 */

import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import { overlayProps } from "@/components/crm/shared/ui-tokens";

import type {
  CrmAttributeDefinition,
  CrmValue,
} from "../../../../shared/crm-contract";
import { AttributeRowShell, PANEL_SECTION_HEADING } from "./attribute-row";
import { FieldEditor, FieldLockNote, FieldValueDisplay } from "./field-editors";
import { FieldHistoryButton } from "./FieldHistory";
import {
  fieldEditability,
  splitHighlights,
  withoutSuppressedDuplicates,
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
  const attributes = withoutSuppressedDuplicates(page.attributes, page.values);
  const { highlights, rest } = splitHighlights(attributes, {
    kind: page.record.kind,
    values: page.values,
  });

  const row = (attribute: CrmAttributeDefinition) => (
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
  );

  return (
    <>
      <section aria-labelledby="crm-record-highlights">
        <h2 id="crm-record-highlights" className={PANEL_SECTION_HEADING}>
          {t("record.highlights")}
        </h2>
        <div className="mt-2">
          {highlights.length ? (
            highlights.map(row)
          ) : (
            <p className="py-3 text-sm text-content-tertiary">
              {t("record.noAttributes")}
            </p>
          )}
        </div>
      </section>

      {rest.length ? (
        <details open className="group/details">
          <summary
            className={`flex cursor-pointer list-none items-center gap-1.5 ${PANEL_SECTION_HEADING}`}
          >
            <IconChevronRight className="size-3.5 transition-transform group-open/details:rotate-90" />
            {t("record.allAttributes")}
          </summary>
          <div className="mt-2">{rest.map(row)}</div>
        </details>
      ) : null}
    </>
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

  // Provenance rides on the row's tooltip instead of a hover-revealed caption:
  // a caption either reserves ~15px on every row (killing the 36px rhythm) or
  // grows the row on hover, and animating layout is off the table. The history
  // dialog still carries the full actor-and-when list.
  const title = [
    attribute.description ?? attribute.label,
    meta
      ? t("record.lastSetBy", { actor: meta.actorId ?? meta.actorType })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AttributeRowShell
      type={attribute.attributeType}
      label={attribute.label}
      title={title}
      affordance={
        attribute.historyTracked ? (
          <FieldHistoryButton recordId={recordId} attribute={attribute} />
        ) : null
      }
    >
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
          {...overlayProps({
            className: "w-full cursor-pointer rounded-lg px-2 py-1 text-left",
          })}
          onClick={onStartEdit}
        >
          <FieldValueDisplay attribute={attribute} value={value} />
        </button>
      ) : (
        <div className="grid gap-1 px-2 py-1">
          <FieldValueDisplay attribute={attribute} value={value} />
          <FieldLockNote reason={editability.reason} />
        </div>
      )}
    </AttributeRowShell>
  );
}
