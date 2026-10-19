import type {
  ContentDatabaseItemLayout,
  ContentDatabaseItemLeadingKind,
  ContentDatabaseItemTitleWeight,
} from "./api";
import {
  isPrimaryBlocksField,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "./properties";

export const CONTENT_DATABASE_ITEM_LEADING_KINDS = [
  "none",
  "page_icon",
  "checkbox",
  "status",
] as const satisfies readonly ContentDatabaseItemLeadingKind[];

export const CONTENT_DATABASE_ITEM_TITLE_WEIGHTS = [
  "regular",
  "medium",
  "bold",
] as const satisfies readonly ContentDatabaseItemTitleWeight[];

export const CONTENT_DATABASE_ITEM_LINE2_LINES = [1, 2, 3] as const;

/** Most properties line 3 or the trailing slot may show. */
export const MAX_ITEM_LAYOUT_META_PROPERTIES = 6;

export const CONTENT_DATABASE_ITEM_LAYOUT_SLOTS = [
  "leading",
  "title",
  "line2",
  "line3",
  "trailing",
] as const;

export type ContentDatabaseItemLayoutSlot =
  (typeof CONTENT_DATABASE_ITEM_LAYOUT_SLOTS)[number];

export const CONTENT_DATABASE_ITEM_LAYOUT_PRESET_IDS = [
  "default",
  "checklist",
  "reminders",
  "tracker",
  "digest",
] as const;

export type ContentDatabaseItemLayoutPresetId =
  (typeof CONTENT_DATABASE_ITEM_LAYOUT_PRESET_IDS)[number];

export interface ContentDatabaseItemLayoutPropertyLike {
  definition: {
    id: string;
    type: DocumentPropertyType;
    options?: DocumentPropertyOptions | null;
  };
}

const LEADING_PROPERTY_TYPES: Partial<
  Record<ContentDatabaseItemLeadingKind, DocumentPropertyType>
> = {
  checkbox: "checkbox",
  status: "status",
};

const LINE2_PROPERTY_TYPES: readonly DocumentPropertyType[] = [
  "text",
  "url",
  "blocks",
];

/** Properties a leading checkbox or status can show. */
export function itemLayoutLeadingCandidates<
  P extends ContentDatabaseItemLayoutPropertyLike,
>(properties: readonly P[], kind: ContentDatabaseItemLeadingKind): P[] {
  const type = LEADING_PROPERTY_TYPES[kind];
  if (!type) return [];
  return properties.filter((property) => property.definition.type === type);
}

/** Text-like properties line 2 can show. The page body arrives separately. */
export function itemLayoutLine2Candidates<
  P extends ContentDatabaseItemLayoutPropertyLike,
>(properties: readonly P[]): P[] {
  return properties.filter(
    (property) =>
      LINE2_PROPERTY_TYPES.includes(property.definition.type) &&
      !(
        property.definition.type === "blocks" &&
        isPrimaryBlocksField(property.definition.options ?? {})
      ),
  );
}

/** Properties line 3 and the trailing slot can show as short values. */
export function itemLayoutMetaCandidates<
  P extends ContentDatabaseItemLayoutPropertyLike,
>(properties: readonly P[]): P[] {
  return properties.filter((property) => property.definition.type !== "blocks");
}

function propertyIdOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id ? id : null;
}

function propertyIdList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = propertyIdOrNull(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_ITEM_LAYOUT_META_PROPERTIES) break;
  }
  return ids;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads a saved item layout, filling anything missing. Null means the view
 * keeps its default rows.
 */
export function normalizeContentDatabaseItemLayout(
  value: unknown,
): ContentDatabaseItemLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const leading = record(raw.leading);
  const line2 = record(raw.line2);
  const kind = CONTENT_DATABASE_ITEM_LEADING_KINDS.includes(
    leading.kind as ContentDatabaseItemLeadingKind,
  )
    ? (leading.kind as ContentDatabaseItemLeadingKind)
    : "page_icon";
  const lines = CONTENT_DATABASE_ITEM_LINE2_LINES.includes(
    line2.lines as 1 | 2 | 3,
  )
    ? (line2.lines as 1 | 2 | 3)
    : 1;
  return {
    leading: {
      kind,
      propertyId: LEADING_PROPERTY_TYPES[kind]
        ? propertyIdOrNull(leading.propertyId)
        : null,
    },
    titleWeight: CONTENT_DATABASE_ITEM_TITLE_WEIGHTS.includes(
      raw.titleWeight as ContentDatabaseItemTitleWeight,
    )
      ? (raw.titleWeight as ContentDatabaseItemTitleWeight)
      : "medium",
    line2: { propertyId: propertyIdOrNull(line2.propertyId), lines },
    line3: propertyIdList(raw.line3),
    trailing: propertyIdList(raw.trailing),
  };
}

/**
 * The `itemLayout` field of a normalized view. An explicit null is kept so a
 * reset to default rows overrides the layout saved on the server; a missing
 * or unreadable value is left out so saves that don't know about layouts
 * keep the saved one.
 */
export function contentDatabaseItemLayoutField(value: unknown): {
  itemLayout?: ContentDatabaseItemLayout | null;
} {
  if (value === null) return { itemLayout: null };
  const itemLayout = normalizeContentDatabaseItemLayout(value);
  return itemLayout ? { itemLayout } : {};
}

/** Carries the saved layout into a full-view save that left it out. */
export function withSavedContentDatabaseItemLayout<
  T extends { id: string; itemLayout?: ContentDatabaseItemLayout | null },
>(
  view: T,
  savedViews: readonly {
    id: string;
    itemLayout?: ContentDatabaseItemLayout | null;
  }[],
): T {
  if (view.itemLayout !== undefined) return view;
  const saved = savedViews.find((candidate) => candidate.id === view.id);
  return saved?.itemLayout === undefined
    ? view
    : { ...view, itemLayout: saved.itemLayout };
}

export interface ResolvedContentDatabaseItemLayout<P> {
  leading: { kind: ContentDatabaseItemLeadingKind; property: P | null };
  titleWeight: ContentDatabaseItemTitleWeight;
  line2: { property: P | null; lines: 1 | 2 | 3 };
  line3: P[];
  trailing: P[];
}

/**
 * Matches a layout's property IDs to the collection's current properties.
 * Missing or mismatched properties drop out, and a checkbox or status slot
 * without a usable property falls back to the page icon.
 */
export function resolveContentDatabaseItemLayout<
  P extends ContentDatabaseItemLayoutPropertyLike,
>(
  layout: ContentDatabaseItemLayout,
  properties: readonly P[],
): ResolvedContentDatabaseItemLayout<P> {
  const byId = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  const leadingCandidates = itemLayoutLeadingCandidates(
    properties,
    layout.leading.kind,
  );
  const leadingProperty = LEADING_PROPERTY_TYPES[layout.leading.kind]
    ? layout.leading.propertyId
      ? (leadingCandidates.find(
          (property) => property.definition.id === layout.leading.propertyId,
        ) ?? null)
      : (leadingCandidates[0] ?? null)
    : null;
  const line2Candidates = new Set(itemLayoutLine2Candidates(properties));
  const line2Property = layout.line2.propertyId
    ? (byId.get(layout.line2.propertyId) ?? null)
    : null;
  const meta = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const property = byId.get(id);
      return property && property.definition.type !== "blocks"
        ? [property]
        : [];
    });
  return {
    leading: {
      kind:
        LEADING_PROPERTY_TYPES[layout.leading.kind] && !leadingProperty
          ? "page_icon"
          : layout.leading.kind,
      property: leadingProperty,
    },
    titleWeight: layout.titleWeight,
    line2: {
      property:
        line2Property && line2Candidates.has(line2Property)
          ? line2Property
          : null,
      lines: layout.line2.lines,
    },
    line3: meta(layout.line3),
    trailing: meta(layout.trailing),
  };
}

/**
 * Lists what is wrong with a layout's property references, for callers that
 * should reject a bad layout instead of rendering around it.
 */
export function contentDatabaseItemLayoutReferenceErrors(
  layout: ContentDatabaseItemLayout,
  properties: readonly ContentDatabaseItemLayoutPropertyLike[],
): string[] {
  const errors: string[] = [];
  const byId = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  const leadingType = LEADING_PROPERTY_TYPES[layout.leading.kind];
  if (leadingType) {
    const property = layout.leading.propertyId
      ? byId.get(layout.leading.propertyId)
      : itemLayoutLeadingCandidates(properties, layout.leading.kind)[0];
    if (!property) {
      errors.push(
        layout.leading.propertyId
          ? `leading.propertyId references unavailable property "${layout.leading.propertyId}".`
          : `A ${layout.leading.kind} leading slot needs a ${leadingType} property.`,
      );
    } else if (property.definition.type !== leadingType) {
      errors.push(
        `leading.propertyId must reference a ${leadingType} property for a ${layout.leading.kind} leading slot.`,
      );
    }
  }
  if (layout.line2.propertyId) {
    const property = byId.get(layout.line2.propertyId);
    if (!property) {
      errors.push(
        `line2.propertyId references unavailable property "${layout.line2.propertyId}".`,
      );
    } else if (!itemLayoutLine2Candidates([property]).length) {
      errors.push(
        "line2.propertyId must reference a text, URL, or non-body Blocks property.",
      );
    }
  }
  for (const slot of ["line3", "trailing"] as const) {
    for (const id of layout[slot]) {
      const property = byId.get(id);
      if (!property) {
        errors.push(`${slot} references unavailable property "${id}".`);
      } else if (property.definition.type === "blocks") {
        errors.push(`${slot} cannot show the Blocks property "${id}".`);
      }
    }
  }
  return errors;
}

/**
 * The layout someone starts editing from on a view with no saved layout. It
 * matches the default rows: page icon, title, and the first few properties.
 */
export function startingContentDatabaseItemLayout(
  visibleProperties: readonly ContentDatabaseItemLayoutPropertyLike[],
): ContentDatabaseItemLayout {
  return {
    leading: { kind: "page_icon", propertyId: null },
    titleWeight: "medium",
    line2: { propertyId: null, lines: 1 },
    line3: [],
    trailing: itemLayoutMetaCandidates(visibleProperties)
      .slice(0, 4)
      .map((property) => property.definition.id),
  };
}

export interface ContentDatabaseItemLayoutPreset {
  id: ContentDatabaseItemLayoutPresetId;
  /** Null for Default, which keeps the view's default rows. */
  layout: ContentDatabaseItemLayout | null;
  /** The property type the preset needs but the collection lacks. */
  missingPropertyType: "checkbox" | "status" | null;
}

function firstOfType<P extends ContentDatabaseItemLayoutPropertyLike>(
  properties: readonly P[],
  ...types: DocumentPropertyType[]
) {
  for (const type of types) {
    const match = properties.find(
      (property) => property.definition.type === type,
    );
    if (match) return match.definition.id;
  }
  return null;
}

/** Named starting points for a list's rows, built from the collection's properties. */
export function contentDatabaseItemLayoutPresets(
  properties: readonly ContentDatabaseItemLayoutPropertyLike[],
): ContentDatabaseItemLayoutPreset[] {
  const checkbox = firstOfType(properties, "checkbox");
  const status = firstOfType(properties, "status");
  const text = itemLayoutLine2Candidates(properties)[0]?.definition.id ?? null;
  const date = firstOfType(properties, "date");
  const person = firstOfType(properties, "person");
  const tag = firstOfType(properties, "multi_select", "select");
  const ids = (...list: Array<string | null>) =>
    list.filter((id): id is string => !!id);

  return [
    { id: "default", layout: null, missingPropertyType: null },
    {
      id: "checklist",
      missingPropertyType: checkbox ? null : "checkbox",
      layout: {
        leading: { kind: "checkbox", propertyId: checkbox },
        titleWeight: "bold",
        line2: { propertyId: text, lines: 2 },
        line3: [],
        trailing: [],
      },
    },
    {
      id: "reminders",
      missingPropertyType: checkbox ? null : "checkbox",
      layout: {
        leading: { kind: "checkbox", propertyId: checkbox },
        titleWeight: "medium",
        line2: { propertyId: text, lines: 1 },
        line3: ids(date, person, tag),
        trailing: [],
      },
    },
    {
      id: "tracker",
      missingPropertyType: status ? null : "status",
      layout: {
        leading: { kind: "status", propertyId: status },
        titleWeight: "regular",
        line2: { propertyId: null, lines: 1 },
        line3: [],
        trailing: ids(tag, person, date),
      },
    },
    {
      id: "digest",
      missingPropertyType: null,
      layout: {
        leading: { kind: "page_icon", propertyId: null },
        titleWeight: "bold",
        line2: { propertyId: text, lines: 3 },
        line3: ids(status, date, tag),
        trailing: [],
      },
    },
  ];
}

function sameLayout(
  a: ContentDatabaseItemLayout | null,
  b: ContentDatabaseItemLayout | null,
) {
  return (
    JSON.stringify(normalizeContentDatabaseItemLayout(a)) ===
    JSON.stringify(normalizeContentDatabaseItemLayout(b))
  );
}

/** The preset a layout currently matches, or null for a custom layout. */
export function matchingContentDatabaseItemLayoutPreset(
  layout: ContentDatabaseItemLayout | null | undefined,
  properties: readonly ContentDatabaseItemLayoutPropertyLike[],
): ContentDatabaseItemLayoutPresetId | null {
  const current = layout ?? null;
  return (
    contentDatabaseItemLayoutPresets(properties).find(
      (preset) =>
        !preset.missingPropertyType && sameLayout(preset.layout, current),
    )?.id ?? null
  );
}
