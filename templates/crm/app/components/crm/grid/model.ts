
import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
  type CrmAttributeType,
} from "../../../../shared/crm-attributes";
import type {
  CrmActorType,
  CrmAttributeAuthority,
  CrmAttributeOption,
  CrmFieldStoragePolicy,
} from "../../../../shared/crm-contract";
import {
  assertValueRegistryComplete,
  ATTRIBUTE_VALUE_SPECS,
  copyAttributeValue,
  formatAttributeValue,
  parseAttributeValue,
  type CrmAttributeValue,
  type CrmValueParse,
  type CrmValueParseFailure,
  type CrmValueSpec,
} from "../shared/attribute-value";

export { statusOverrunDays } from "../shared/attribute-value";

export type CrmCellValue = CrmAttributeValue;

export interface CrmGridAttribute {
  id: string;
  apiSlug: string;
  label: string;
  attributeType: CrmAttributeType;
  multi: boolean;
  authority: CrmAttributeAuthority;
  storagePolicy: CrmFieldStoragePolicy;
  updateable: boolean;
  options?: CrmAttributeOption[];
  config?: Record<string, unknown>;
}

export interface CrmCellProvenance {
  actorType: CrmActorType;
  actorId?: string | null;
  readable: boolean;
  source?: string;
  sourceUrl?: string;
  confidence?: number;
  reasoning?: string;
  observedAt?: string;
}

export interface CrmGridRow {
  id: string;
  displayName: string;
  remoteRevision?: string;
  values: Record<string, CrmCellValue>;
  valuesSince?: Record<string, string>;
  provenance?: Record<string, CrmCellProvenance>;
}

export type CrmCellEditor =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "options"
  | "rating"
  | "reference"
  | "readonly";

export type CrmCellParseFailure = CrmValueParseFailure;
export type CrmCellParse = CrmValueParse;

export interface CrmCellSpec extends CrmValueSpec {
  editor: CrmCellEditor;
  defaultWidth: number;
}


const COLUMN_WIDTHS: Record<CrmAttributeType, number> = {
  text: 220,
  number: 130,
  checkbox: 90,
  currency: 140,
  date: 140,
  timestamp: 180,
  rating: 120,
  status: 170,
  select: 170,
  "record-reference": 200,
  "actor-reference": 200,
  location: 200,
  domain: 190,
  "email-address": 230,
  "phone-number": 170,
  interaction: 200,
  "personal-name": 200,
};

export const CELL_SPECS: Record<CrmAttributeType, CrmCellSpec> =
  Object.fromEntries(
    CRM_ATTRIBUTE_TYPES.map((type) => {
      const spec = ATTRIBUTE_VALUE_SPECS[type];
      return [
        type,
        {
          ...spec,
          editor: spec.control === "none" ? "readonly" : spec.control,
          defaultWidth: COLUMN_WIDTHS[type],
        } satisfies CrmCellSpec,
      ];
    }),
  ) as Record<CrmAttributeType, CrmCellSpec>;

export function cellSpecFor(attribute: CrmGridAttribute): CrmCellSpec {
  const spec = CELL_SPECS[attribute.attributeType];
  if (!attribute.updateable && spec.editor !== "readonly") {
    return { ...spec, editor: "readonly" };
  }
  return spec;
}

export function isCellEditable(attribute: CrmGridAttribute): boolean {
  return cellSpecFor(attribute).editor !== "readonly";
}

export function assertCellRegistryComplete(): void {
  assertValueRegistryComplete();
  for (const type of CRM_ATTRIBUTE_TYPES) {
    if (typeof COLUMN_WIDTHS[type] !== "number") {
      throw new Error(
        `CRM grid has no column width for attribute type "${type}".`,
      );
    }
    if (
      ATTRIBUTE_TYPE_SPECS[type].systemOnly &&
      CELL_SPECS[type].editor !== "readonly"
    ) {
      throw new Error(
        `CRM grid must render system-only attribute type "${type}" read-only.`,
      );
    }
  }
}

export function formatCell(
  attribute: CrmGridAttribute,
  value: CrmCellValue,
  locale?: string,
): string {
  return formatAttributeValue(attribute, value, locale);
}

export function copyCell(
  attribute: CrmGridAttribute,
  value: CrmCellValue,
  locale?: string,
): string {
  return copyAttributeValue(attribute, value, locale);
}

export function parseCell(
  attribute: CrmGridAttribute,
  text: string,
  locale?: string,
): CrmCellParse {
  if (!isCellEditable(attribute)) return { ok: false, reason: "read-only" };
  return parseAttributeValue(attribute, text, locale);
}


function sameCellValue(a: CrmCellValue, b: CrmCellValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function isSuppressedDisplayNameCell(
  apiSlug: string,
  rowValues: Record<string, CrmCellValue>,
): boolean {
  if (apiSlug !== "displayName") return false;
  const name = rowValues.name;
  if (!name) return false;
  return sameCellValue(name, rowValues.displayName);
}


const PROVENANCE_ACTORS: readonly CrmActorType[] = [
  "user",
  "agent",
  "automation",
  "provider",
  "system",
];

export function parseCellProvenance(input: {
  actorType: string;
  actorId?: string | null;
  provenanceJson: string | null | undefined;
  fieldName?: string;
}): CrmCellProvenance {
  const actorType = (PROVENANCE_ACTORS as readonly string[]).includes(
    input.actorType,
  )
    ? (input.actorType as CrmActorType)
    : "system";
  const base: CrmCellProvenance = {
    actorType,
    actorId: input.actorId ?? null,
    readable: true,
  };
  if (input.provenanceJson == null || input.provenanceJson === "") return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.provenanceJson);
  } catch {
    return { ...base, readable: false };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const match = entries.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (!input.fieldName ||
        (entry as Record<string, unknown>).fieldName === undefined ||
        (entry as Record<string, unknown>).fieldName === input.fieldName),
  );
  if (!match) return base;
  const text = (key: string) =>
    typeof match[key] === "string" && match[key] !== ""
      ? (match[key] as string)
      : undefined;
  const confidence =
    typeof match.confidence === "number" && Number.isFinite(match.confidence)
      ? match.confidence
      : undefined;
  return {
    ...base,
    ...(text("provider") ? { source: text("provider") } : {}),
    ...((text("sourceUrl") ?? text("evidenceRef"))
      ? { sourceUrl: text("sourceUrl") ?? text("evidenceRef") }
      : {}),
    ...(confidence === undefined ? {} : { confidence }),
    ...(text("reasoning") ? { reasoning: text("reasoning") } : {}),
    ...(text("observedAt") ? { observedAt: text("observedAt") } : {}),
  };
}
