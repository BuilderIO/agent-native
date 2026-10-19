import type {
  ContentDatabaseItemLayout,
  ContentDatabaseItemLeadingKind,
  ContentDatabaseItemTitleWeight,
  DocumentProperty,
} from "@shared/api";
import {
  CONTENT_DATABASE_ITEM_LAYOUT_SLOTS,
  contentDatabaseItemLayoutPresets,
  itemLayoutLeadingCandidates,
  itemLayoutLine2Candidates,
  itemLayoutMetaCandidates,
  matchingContentDatabaseItemLayoutPreset,
  MAX_ITEM_LAYOUT_META_PROPERTIES,
  startingContentDatabaseItemLayout,
  type ContentDatabaseItemLayoutPresetId,
  type ContentDatabaseItemLayoutSlot,
} from "@shared/database-item-layout";
import { IconCheck, IconPencil } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import { dbText } from "./DatabaseView";

const SLOT_LABEL_KEYS = {
  leading: "listRowsStart",
  title: "listRowsTitle",
  line2: "listRowsLine2",
  line3: "listRowsLine3",
  trailing: "listRowsEnd",
} as const satisfies Record<
  ContentDatabaseItemLayoutSlot,
  Parameters<typeof dbText>[0]
>;

const PRESET_LABEL_KEYS = {
  default: "listRowsPresetDefault",
  checklist: "listRowsPresetChecklist",
  reminders: "listRowsPresetReminders",
  tracker: "listRowsPresetTracker",
  digest: "listRowsPresetDigest",
} as const satisfies Record<
  ContentDatabaseItemLayoutPresetId,
  Parameters<typeof dbText>[0]
>;

export function listItemLayoutSlotLabel(slot: ContentDatabaseItemLayoutSlot) {
  return dbText(SLOT_LABEL_KEYS[slot]);
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={option.disabled}
          aria-pressed={value === option.value}
          className={cn(
            "h-7 rounded-md border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            value === option.value
              ? "border-database-blue bg-database-blue/5 text-database-blue"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PropertyChoices({
  label,
  properties,
  selectedIds: savedIds,
  multiple,
  noneLabel,
  onChange,
}: {
  label: string;
  properties: DocumentProperty[];
  selectedIds: string[];
  multiple: boolean;
  noneLabel?: string;
  onChange: (ids: string[]) => void;
}) {
  // A saved slot can name a property that has since been deleted or hidden.
  // It isn't shown, so it doesn't count toward the limit and is dropped on
  // the next change.
  const selectedIds = savedIds.filter((id) =>
    properties.some((property) => property.definition.id === id),
  );
  const rows = [
    ...(noneLabel ? [{ id: "", name: noneLabel }] : []),
    ...properties.map((property) => ({
      id: property.definition.id,
      name: property.definition.name,
    })),
  ];
  return (
    <div
      role="group"
      aria-label={label}
      className="grid max-h-56 gap-0.5 overflow-y-auto"
    >
      {rows.map((row) => {
        const selected = row.id
          ? selectedIds.includes(row.id)
          : selectedIds.length === 0;
        const position = row.id ? selectedIds.indexOf(row.id) : -1;
        const full =
          multiple &&
          !selected &&
          !!row.id &&
          selectedIds.length >= MAX_ITEM_LAYOUT_META_PROPERTIES;
        return (
          <button
            key={row.id || "none"}
            type="button"
            aria-pressed={selected}
            disabled={full}
            className="flex h-8 items-center gap-2 rounded px-2 text-left text-sm enabled:hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onClick={() => {
              if (!row.id) return onChange([]);
              if (!multiple) return onChange([row.id]);
              onChange(
                selected
                  ? selectedIds.filter((id) => id !== row.id)
                  : [...selectedIds, row.id],
              );
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {selected ? (
                <IconCheck className="size-4 text-database-blue" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            {multiple && position >= 0 ? (
              <span className="text-xs text-muted-foreground">
                {position + 1}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The controls for one slot, shared by the Layout panel and the row popovers. */
export function ListItemLayoutSlotEditor({
  slot,
  layout,
  properties,
  onChange,
}: {
  slot: ContentDatabaseItemLayoutSlot;
  layout: ContentDatabaseItemLayout;
  properties: DocumentProperty[];
  onChange: (layout: ContentDatabaseItemLayout) => void;
}) {
  const label = listItemLayoutSlotLabel(slot);
  if (slot === "leading") {
    const checkboxes = itemLayoutLeadingCandidates(properties, "checkbox");
    const statuses = itemLayoutLeadingCandidates(properties, "status");
    const kind = layout.leading.kind;
    const candidates =
      kind === "checkbox" ? checkboxes : kind === "status" ? statuses : [];
    return (
      <div className="grid gap-2">
        <Segmented<ContentDatabaseItemLeadingKind>
          label={label}
          value={kind}
          options={[
            { value: "none", label: dbText("none") },
            { value: "page_icon", label: dbText("listRowsPageIcon") },
            {
              value: "checkbox",
              label: dbText("listRowsCheckbox"),
              disabled: checkboxes.length === 0,
            },
            {
              value: "status",
              label: dbText("listRowsStatus"),
              disabled: statuses.length === 0,
            },
          ]}
          onChange={(next) =>
            onChange({
              ...layout,
              leading: {
                kind: next,
                propertyId:
                  next === "checkbox"
                    ? (checkboxes[0]?.definition.id ?? null)
                    : next === "status"
                      ? (statuses[0]?.definition.id ?? null)
                      : null,
              },
            })
          }
        />
        {candidates.length > 1 ? (
          <PropertyChoices
            label={label}
            properties={candidates}
            selectedIds={
              layout.leading.propertyId ? [layout.leading.propertyId] : []
            }
            multiple={false}
            onChange={([id]) =>
              onChange({
                ...layout,
                leading: { kind, propertyId: id ?? null },
              })
            }
          />
        ) : null}
      </div>
    );
  }
  if (slot === "title") {
    return (
      <Segmented<ContentDatabaseItemTitleWeight>
        label={label}
        value={layout.titleWeight}
        options={[
          { value: "regular", label: dbText("listRowsRegular") },
          { value: "medium", label: dbText("listRowsMedium") },
          { value: "bold", label: dbText("listRowsBold") },
        ]}
        onChange={(titleWeight) => onChange({ ...layout, titleWeight })}
      />
    );
  }
  if (slot === "line2") {
    return (
      <div className="grid gap-2">
        <PropertyChoices
          label={label}
          properties={itemLayoutLine2Candidates(properties)}
          selectedIds={layout.line2.propertyId ? [layout.line2.propertyId] : []}
          multiple={false}
          noneLabel={dbText("listRowsNothing")}
          onChange={([id]) =>
            onChange({
              ...layout,
              line2: { ...layout.line2, propertyId: id ?? null },
            })
          }
        />
        {layout.line2.propertyId ? (
          <Segmented<1 | 2 | 3>
            label={label}
            value={layout.line2.lines}
            options={[
              { value: 1, label: dbText("listRowsOneLine") },
              { value: 2, label: dbText("listRowsLineCount", { count: 2 }) },
              { value: 3, label: dbText("listRowsLineCount", { count: 3 }) },
            ]}
            onChange={(lines) =>
              onChange({ ...layout, line2: { ...layout.line2, lines } })
            }
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <PropertyChoices
        label={label}
        properties={itemLayoutMetaCandidates(properties)}
        selectedIds={layout[slot]}
        multiple
        noneLabel={dbText("listRowsNothing")}
        onChange={(ids) => onChange({ ...layout, [slot]: ids })}
      />
      {slot === "trailing" ? (
        <div className="text-xs text-muted-foreground">
          {dbText("listRowsEndHint")}
        </div>
      ) : null}
    </div>
  );
}

export function ListItemLayoutPresets({
  layout,
  properties,
  onChange,
}: {
  layout: ContentDatabaseItemLayout | null;
  properties: DocumentProperty[];
  onChange: (layout: ContentDatabaseItemLayout | null) => void;
}) {
  const active = matchingContentDatabaseItemLayoutPreset(layout, properties);
  return (
    <div className="flex flex-wrap gap-1.5">
      {contentDatabaseItemLayoutPresets(properties).map((preset) => {
        const unavailable = preset.missingPropertyType
          ? dbText(
              preset.missingPropertyType === "checkbox"
                ? "listRowsNeedsCheckbox"
                : "listRowsNeedsStatus",
            )
          : undefined;
        return (
          <button
            key={preset.id}
            type="button"
            disabled={!!unavailable}
            title={unavailable}
            aria-pressed={active === preset.id}
            className={cn(
              "h-7 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              active === preset.id
                ? "border-database-blue bg-database-blue text-database-blue-foreground"
                : "border-border text-foreground hover:bg-muted",
            )}
            onClick={() => onChange(preset.layout)}
          >
            {dbText(PRESET_LABEL_KEYS[preset.id])}
          </button>
        );
      })}
    </div>
  );
}

/** The Rows section of a list view's Layout panel. */
export function DatabaseListRowsSetting({
  itemLayout,
  properties,
  visibleProperties,
  editingOnList,
  onChange,
  onEditOnList,
}: {
  itemLayout: ContentDatabaseItemLayout | null;
  properties: DocumentProperty[];
  visibleProperties: DocumentProperty[];
  editingOnList: boolean;
  onChange: (layout: ContentDatabaseItemLayout | null) => void;
  onEditOnList: () => void;
}) {
  const working =
    itemLayout ?? startingContentDatabaseItemLayout(visibleProperties);
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <div className="text-sm font-medium text-foreground">
            {dbText("listRows")}
          </div>
          <div className="text-xs text-muted-foreground">
            {dbText("listRowsDescription")}
          </div>
        </div>
        {editingOnList ? null : (
          <button
            type="button"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-database-blue hover:bg-database-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onEditOnList}
          >
            <IconPencil className="size-3.5" />
            {dbText("listRowsEditOnList")}
          </button>
        )}
      </div>
      <ListItemLayoutPresets
        layout={itemLayout}
        properties={properties}
        onChange={onChange}
      />
      {CONTENT_DATABASE_ITEM_LAYOUT_SLOTS.map((slot) => (
        <div key={slot} className="grid gap-1.5">
          <div className="text-xs text-muted-foreground">
            {listItemLayoutSlotLabel(slot)}
          </div>
          <ListItemLayoutSlotEditor
            slot={slot}
            layout={working}
            properties={properties}
            onChange={onChange}
          />
        </div>
      ))}
    </div>
  );
}
