/**
 * Decision logic behind the CRM settings surfaces.
 *
 * It lives outside the components because `vitest.config.ts` collects
 * `**\/*.test.ts` in a node environment: a `.tsx` component cannot be reached
 * from a test at all, so anything worth proving has to be a plain module.
 *
 * Type behaviour is read from `ATTRIBUTE_TYPE_SPECS`, never re-derived here.
 */

import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
  type CrmAttributeType,
} from "../../../../shared/crm-attributes";
import {
  CRM_CONNECTION_MODES,
  type CrmAttributeAuthority,
  type CrmAttributeDefinition,
  type CrmAttributeOption,
  type CrmConnectionMode,
} from "../../../../shared/crm-contract";

// ---------------------------------------------------------------------------
// Attribute types
// ---------------------------------------------------------------------------

/** Types a person may author. `interaction` and `personal-name` are system-only. */
export const AUTHORED_ATTRIBUTE_TYPES: readonly CrmAttributeType[] =
  CRM_ATTRIBUTE_TYPES.filter((type) => !ATTRIBUTE_TYPE_SPECS[type].systemOnly);

export interface AttributeTypeCapabilities {
  supportsMulti: boolean;
  usesOptions: boolean;
  /** `targetDays` and `celebrate` describe a pipeline stage: status only. */
  showsStageFields: boolean;
}

export function attributeTypeCapabilities(
  type: CrmAttributeType,
): AttributeTypeCapabilities {
  const spec = ATTRIBUTE_TYPE_SPECS[type];
  return {
    supportsMulti: spec.supportsMulti,
    usesOptions: spec.usesOptions,
    showsStageFields: type === "status",
  };
}

/**
 * `api_slug` keys every stored value row and the type chose the column those
 * values live in, so `update-crm-attribute` rejects a change to either.
 * Rendering them as editable would offer a control the server always refuses.
 */
export const IMMUTABLE_ATTRIBUTE_FIELDS = ["apiSlug", "attributeType"] as const;

export type ImmutableAttributeField =
  (typeof IMMUTABLE_ATTRIBUTE_FIELDS)[number];

export function isImmutableAttributeField(
  field: string,
): field is ImmutableAttributeField {
  return (IMMUTABLE_ATTRIBUTE_FIELDS as readonly string[]).includes(field);
}

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

export interface AttributeAuthorityInfo {
  labelKey: string;
  descriptionKey: string;
  /** A local edit cannot be written upstream; it is recorded as a proposal. */
  editsBecomeProposals: boolean;
  badge: "default" | "secondary" | "outline";
}

export const ATTRIBUTE_AUTHORITY_INFO: Record<
  CrmAttributeAuthority,
  AttributeAuthorityInfo
> = {
  provider: {
    labelKey: "fields.authorityProvider",
    descriptionKey: "fields.authorityProviderHelp",
    editsBecomeProposals: true,
    badge: "secondary",
  },
  "derived-local": {
    labelKey: "fields.authorityDerived",
    descriptionKey: "fields.authorityDerivedHelp",
    editsBecomeProposals: false,
    badge: "outline",
  },
  "local-authoritative": {
    labelKey: "fields.authorityLocal",
    descriptionKey: "fields.authorityLocalHelp",
    editsBecomeProposals: false,
    badge: "default",
  },
};

// ---------------------------------------------------------------------------
// Drafts and action payloads
// ---------------------------------------------------------------------------

export interface AttributeOptionDraft {
  value: string;
  title: string;
  color: string | null;
  targetDays: number | null;
  celebrate: boolean;
}

export interface AttributeDraft {
  title: string;
  type: CrmAttributeType;
  description: string;
  multi: boolean;
  required: boolean;
  uniqueValue: boolean;
  historyTracked: boolean;
  options: AttributeOptionDraft[];
}

export function emptyAttributeDraft(): AttributeDraft {
  return {
    title: "",
    type: "text",
    description: "",
    multi: false,
    required: false,
    uniqueValue: false,
    historyTracked: true,
    options: [],
  };
}

export function emptyAttributeOptionDraft(): AttributeOptionDraft {
  return {
    value: "",
    title: "",
    color: null,
    targetDays: null,
    celebrate: false,
  };
}

export interface CrmAttributeTarget {
  target: "object" | "list";
  targetId: string;
  connectionId?: string;
}

export interface CreateAttributeInput extends CrmAttributeTarget {
  title: string;
  type: CrmAttributeType;
  multi: boolean;
  required: boolean;
  uniqueValue: boolean;
  historyTracked: boolean;
  description?: string;
  options?: Array<{
    value: string;
    title: string;
    color?: string;
    targetDays?: number | null;
    celebrate?: boolean;
  }>;
}

/**
 * The exact payload `create-crm-attribute` accepts for a draft. Options and
 * stage fields are dropped for types that do not take them: the action rejects
 * both with a 422, and the picker that produced the draft may have been showing
 * them before the type changed.
 */
export function buildCreateAttributeInput(
  draft: AttributeDraft,
  target: CrmAttributeTarget,
): CreateAttributeInput {
  const capabilities = attributeTypeCapabilities(draft.type);
  const description = draft.description.trim();
  const options = capabilities.usesOptions
    ? draft.options
        .filter((option) => option.value.trim())
        .map((option) => ({
          value: option.value.trim(),
          title: option.title.trim() || option.value.trim(),
          ...(option.color ? { color: option.color } : {}),
          ...(capabilities.showsStageFields
            ? { targetDays: option.targetDays, celebrate: option.celebrate }
            : {}),
        }))
    : [];

  return {
    target: target.target,
    targetId: target.targetId,
    ...(target.connectionId ? { connectionId: target.connectionId } : {}),
    title: draft.title.trim(),
    type: draft.type,
    multi: capabilities.supportsMulti && draft.multi,
    required: draft.required,
    uniqueValue: draft.uniqueValue,
    historyTracked: draft.historyTracked,
    ...(description ? { description } : {}),
    ...(options.length ? { options } : {}),
  };
}

export interface AttributeEditDraft {
  title: string;
  description: string;
  required: boolean;
  historyTracked: boolean;
}

export interface UpdateAttributeInput {
  attributeId: string;
  title?: string;
  description?: string | null;
  required?: boolean;
  historyTracked?: boolean;
}

export function attributeEditDraft(
  attribute: CrmAttributeDefinition,
): AttributeEditDraft {
  return {
    title: attribute.label,
    description: attribute.description ?? "",
    required: attribute.required,
    historyTracked: attribute.historyTracked,
  };
}

/**
 * Only the fields that actually changed, and never `apiSlug` or `type`: the
 * action accepts those two solely to reject them with an explanation.
 */
export function buildUpdateAttributeInput(
  attribute: CrmAttributeDefinition,
  draft: AttributeEditDraft,
): UpdateAttributeInput {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const current = attributeEditDraft(attribute);
  return {
    attributeId: attribute.id,
    ...(title && title !== current.title ? { title } : {}),
    ...(description === current.description.trim()
      ? {}
      : { description: description || null }),
    ...(draft.required === current.required
      ? {}
      : { required: draft.required }),
    ...(draft.historyTracked === current.historyTracked
      ? {}
      : { historyTracked: draft.historyTracked }),
  };
}

export function hasAttributeEdits(input: UpdateAttributeInput): boolean {
  return Object.keys(input).length > 1;
}

// ---------------------------------------------------------------------------
// Optimistic cache patching
// ---------------------------------------------------------------------------

export interface CrmAttributeListResult {
  target: "object" | "list";
  targetId: string;
  attributes: CrmAttributeDefinition[];
}

export function applyAttributePatch(
  result: CrmAttributeListResult | undefined,
  attributeId: string,
  patch: Partial<CrmAttributeDefinition>,
): CrmAttributeListResult | undefined {
  if (!result) return result;
  return {
    ...result,
    attributes: result.attributes.map((attribute) =>
      attribute.id === attributeId ? { ...attribute, ...patch } : attribute,
    ),
  };
}

// ---------------------------------------------------------------------------
// Option ordering
// ---------------------------------------------------------------------------

/** A copy with `from` moved to `to`. Out-of-range indices leave the order alone. */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length ||
    from === to
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** The `optionIds` payload `manage-crm-attribute-option` reorder expects. */
export function reorderedOptionIds(
  options: readonly CrmAttributeOption[],
  from: number,
  to: number,
): string[] {
  return moveItem(options, from, to).map((option) => option.id);
}

// ---------------------------------------------------------------------------
// Connection modes
// ---------------------------------------------------------------------------

export interface CrmConnectionModeInfo {
  mode: CrmConnectionMode;
  labelKey: string;
  descriptionKey: string;
  /** Deprecated modes still render for existing rows; they are never offered. */
  deprecated: boolean;
}

export const CRM_CONNECTION_MODE_INFO: Record<
  CrmConnectionMode,
  CrmConnectionModeInfo
> = {
  native: {
    mode: "native",
    labelKey: "connection.modeNative",
    descriptionKey: "connection.modeNativeHelp",
    deprecated: false,
  },
  connected: {
    mode: "connected",
    labelKey: "connection.modeConnected",
    descriptionKey: "connection.modeConnectedHelp",
    deprecated: false,
  },
  hybrid: {
    mode: "hybrid",
    labelKey: "connection.modeHybrid",
    descriptionKey: "connection.modeHybridHelp",
    deprecated: true,
  },
};

/**
 * The only set a mode picker may offer. `hybrid` is derived out rather than
 * hand-omitted so it cannot reappear by someone extending a literal list.
 */
export const SELECTABLE_CRM_CONNECTION_MODES: readonly CrmConnectionMode[] =
  CRM_CONNECTION_MODES.filter(
    (mode) => !CRM_CONNECTION_MODE_INFO[mode].deprecated,
  );

/**
 * Null for a mode this build does not know. The caller must render that as
 * unrecognized — falling back to a default would print a confident wrong label
 * for a row whose real mode nobody can read.
 */
export function connectionModeInfo(mode: string): CrmConnectionModeInfo | null {
  return CRM_CONNECTION_MODE_INFO[mode as CrmConnectionMode] ?? null;
}
