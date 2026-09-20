/**
 * The single CRM attribute-type registry.
 *
 * Every place that needs to know "which column does this type live in", "can it
 * be multi-valued", "does it take managed options", or "which composite
 * sub-columns does it populate" reads it from here. Adding a type means adding
 * one entry to `ATTRIBUTE_TYPE_SPECS` — not another `switch` in an action.
 */

export const CRM_ATTRIBUTE_TYPES = [
  "text",
  "number",
  "checkbox",
  "currency",
  "date",
  "timestamp",
  "rating",
  "status",
  "select",
  "record-reference",
  "actor-reference",
  "location",
  "domain",
  "email-address",
  "phone-number",
  "interaction",
  "personal-name",
] as const;

export type CrmAttributeType = (typeof CRM_ATTRIBUTE_TYPES)[number];

/** Which `crm_record_fields` value column a single (non-multi) value lands in. */
export type CrmAttributeStorageColumn =
  | "stringValue"
  | "numberValue"
  | "booleanValue"
  | "jsonValue";

/** Sparse, indexable composite columns on `crm_record_fields`. */
export type CrmRecordFieldSubColumn =
  | "emailLocal"
  | "emailDomain"
  | "emailRootDomain"
  | "phoneE164"
  | "phoneCountry"
  | "domainRoot"
  | "nameFirst"
  | "nameLast";

export const CRM_RECORD_FIELD_SUB_COLUMNS = [
  "emailLocal",
  "emailDomain",
  "emailRootDomain",
  "phoneE164",
  "phoneCountry",
  "domainRoot",
  "nameFirst",
  "nameLast",
] as const satisfies readonly CrmRecordFieldSubColumn[];

export interface CrmAttributeTypeSpec {
  /** Column a single value is stored in. Multi values always use `jsonValue`. */
  storageColumn: CrmAttributeStorageColumn;
  supportsMulti: boolean;
  /** Values must match a `crm_attribute_options` row; unknown values are a 422. */
  usesOptions: boolean;
  /** Created by the system only — rejected in create-attribute input. */
  systemOnly: boolean;
  /** Composite sub-columns this type derives from its value. */
  subFields: readonly CrmRecordFieldSubColumn[];
}

export const ATTRIBUTE_TYPE_SPECS: Record<
  CrmAttributeType,
  CrmAttributeTypeSpec
> = {
  text: {
    storageColumn: "stringValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  number: {
    storageColumn: "numberValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  checkbox: {
    storageColumn: "booleanValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  currency: {
    storageColumn: "numberValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  date: {
    storageColumn: "stringValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  timestamp: {
    storageColumn: "stringValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  rating: {
    storageColumn: "numberValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  status: {
    storageColumn: "stringValue",
    supportsMulti: false,
    usesOptions: true,
    systemOnly: false,
    subFields: [],
  },
  select: {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: true,
    systemOnly: false,
    subFields: [],
  },
  "record-reference": {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  "actor-reference": {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  location: {
    storageColumn: "jsonValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: false,
    subFields: [],
  },
  domain: {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: false,
    systemOnly: false,
    subFields: ["domainRoot"],
  },
  "email-address": {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: false,
    systemOnly: false,
    subFields: ["emailLocal", "emailDomain", "emailRootDomain"],
  },
  "phone-number": {
    storageColumn: "stringValue",
    supportsMulti: true,
    usesOptions: false,
    systemOnly: false,
    subFields: ["phoneE164", "phoneCountry"],
  },
  interaction: {
    storageColumn: "jsonValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: true,
    subFields: [],
  },
  "personal-name": {
    storageColumn: "stringValue",
    supportsMulti: false,
    usesOptions: false,
    systemOnly: true,
    subFields: ["nameFirst", "nameLast"],
  },
};

export function isCrmAttributeType(value: unknown): value is CrmAttributeType {
  return (
    typeof value === "string" &&
    (CRM_ATTRIBUTE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Storage column for an attribute. A multi-valued attribute holds the whole set
 * as one JSON array — the scalar columns cannot express cardinality.
 */
export function storageColumnFor(
  type: CrmAttributeType,
  multi: boolean,
): CrmAttributeStorageColumn {
  return multi ? "jsonValue" : ATTRIBUTE_TYPE_SPECS[type].storageColumn;
}

/** The pre-typed `CrmFieldDefinition.valueType` / `crm_field_policies.value_type`
 * union. Kept here (not `crm-contract.ts`) so `legacyValueTypeFor` has no
 * import cycle back to the module that re-exports this file's types. */
export type CrmLegacyValueType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "currency"
  | "percent"
  | "enum"
  | "multi-enum"
  | "reference"
  | "json";

/**
 * The legacy `value_type` column is still NOT NULL and is what the pre-typed
 * read paths (crm-store, mirror, update-crm-record) branch on, so every typed
 * attribute must also carry the closest legacy value type. This is the inverse
 * of the migration's `value_type -> attribute_type` backfill.
 */
const LEGACY_VALUE_TYPES: Record<CrmAttributeType, CrmLegacyValueType> = {
  text: "string",
  number: "number",
  checkbox: "boolean",
  currency: "currency",
  date: "date",
  timestamp: "datetime",
  rating: "number",
  status: "enum",
  select: "enum",
  "record-reference": "reference",
  "actor-reference": "reference",
  location: "json",
  domain: "string",
  "email-address": "string",
  "phone-number": "string",
  interaction: "json",
  "personal-name": "string",
};

export function legacyValueTypeFor(
  type: CrmAttributeType,
  multi: boolean,
): CrmLegacyValueType {
  const base = LEGACY_VALUE_TYPES[type];
  return multi && base === "enum" ? "multi-enum" : base;
}

// ---------------------------------------------------------------------------
// Composite value parsers.
//
// Each returns a discriminated union so an unparseable value is never mistaken
// for an absent one: `absent` means nothing was supplied, `unparseable` means
// something was supplied that this parser could not read. Callers that flatten
// both to null lose the distinction the sparse sub-columns exist to record.
// ---------------------------------------------------------------------------

export type CrmParsedEmail =
  | { status: "absent" }
  | { status: "unparseable"; local: null; domain: null; rootDomain: null }
  | { status: "parsed"; local: string; domain: string; rootDomain: string };

export type CrmParsedPhone =
  | { status: "absent" }
  | { status: "unparseable"; e164: null; country: null }
  | { status: "parsed"; e164: string; country: string | null };

export type CrmParsedPersonalName =
  | { status: "absent" }
  | { status: "unparseable"; first: null; last: null }
  | { status: "parsed"; first: string; last: string | null };

/**
 * Registered suffixes that are themselves public — `example.co.uk` roots to
 * `example.co.uk`, not `co.uk`.
 *
 * ponytail: hand-list, not the full Public Suffix List. Covers the suffixes
 * business contact data actually carries; swap in `psl` if a customer domain
 * lands outside it (the symptom is a root domain of the form `<tld-ish>.<tld>`).
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.nz",
  "co.za",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.hk",
  "co.in",
  "co.kr",
]);

/** Bare hostname for a URL-ish or hostname-ish value, or null when unreadable. */
function hostnameOf(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const withoutUserInfo = host.includes("@")
    ? host.slice(host.lastIndexOf("@") + 1)
    : host;
  const withoutPort = withoutUserInfo.replace(/:\d+$/, "");
  const bare = withoutPort.replace(/^www\./, "").replace(/\.$/, "");
  if (!bare || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare)) return null;
  return bare;
}

/** Registrable domain for a hostname, URL, or email domain. Null when unreadable. */
export function rootDomainOf(value: string | null | undefined): string | null {
  if (value == null) return null;
  const host = hostnameOf(value);
  if (!host) return null;
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length > 2 && MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

export function parseEmail(value: string | null | undefined): CrmParsedEmail {
  if (value == null || !value.trim()) return { status: "absent" };
  const trimmed = value.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  const local = at > 0 ? trimmed.slice(0, at) : "";
  const domain = at > 0 ? trimmed.slice(at + 1) : "";
  const rootDomain = rootDomainOf(domain);
  if (!local || !rootDomain || /\s/.test(trimmed)) {
    return {
      status: "unparseable",
      local: null,
      domain: null,
      rootDomain: null,
    };
  }
  return { status: "parsed", local, domain, rootDomain };
}

/**
 * ISO region for an unambiguous E.164 calling code.
 *
 * ponytail: shared calling codes (+1 spans US/CA/Caribbean, +7 spans RU/KZ)
 * deliberately resolve to `null` rather than guess — a `parsed` result with a
 * null country means "number is valid, region undetermined". Add
 * `libphonenumber-js` if region accuracy ever becomes load-bearing.
 */
const UNAMBIGUOUS_CALLING_CODES: ReadonlyArray<[string, string]> = [
  ["44", "GB"],
  ["49", "DE"],
  ["33", "FR"],
  ["34", "ES"],
  ["39", "IT"],
  ["31", "NL"],
  ["46", "SE"],
  ["47", "NO"],
  ["45", "DK"],
  ["48", "PL"],
  ["351", "PT"],
  ["353", "IE"],
  ["358", "FI"],
  ["61", "AU"],
  ["64", "NZ"],
  ["81", "JP"],
  ["82", "KR"],
  ["86", "CN"],
  ["91", "IN"],
  ["55", "BR"],
  ["52", "MX"],
  ["65", "SG"],
  ["972", "IL"],
  ["27", "ZA"],
];

export function parsePhone(value: string | null | undefined): CrmParsedPhone {
  if (value == null || !value.trim()) return { status: "absent" };
  const trimmed = value.trim();
  // Only an explicitly international number can be normalized without knowing
  // the caller's region — a bare "555 0134" is genuinely unparseable here.
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+") || !/^\+\d{8,15}$/.test(digits)) {
    return { status: "unparseable", e164: null, country: null };
  }
  const national = digits.slice(1);
  const match = UNAMBIGUOUS_CALLING_CODES.filter(([code]) =>
    national.startsWith(code),
  ).sort((a, b) => b[0].length - a[0].length)[0];
  return { status: "parsed", e164: digits, country: match?.[1] ?? null };
}

export function parsePersonalName(
  value: string | null | undefined,
): CrmParsedPersonalName {
  if (value == null || !value.trim()) return { status: "absent" };
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",", 2).map((part) => part.trim());
    if (!last || !first) {
      return { status: "unparseable", first: null, last: null };
    }
    return { status: "parsed", first, last };
  }
  const parts = trimmed.split(" ");
  const first = parts[0] ?? "";
  if (!first) return { status: "unparseable", first: null, last: null };
  const last = parts.slice(1).join(" ");
  return { status: "parsed", first, last: last || null };
}

/**
 * Composite sub-columns for one value, keyed by column name. Every sub-column
 * the type declares is present (possibly null) so a caller can null the rest
 * without re-deriving which ones this type owns.
 */
export function subFieldColumnsFor(
  type: CrmAttributeType,
  value: string | null,
): Partial<Record<CrmRecordFieldSubColumn, string | null>> {
  const spec = ATTRIBUTE_TYPE_SPECS[type];
  if (spec.subFields.length === 0) return {};
  if (type === "email-address") {
    const parsed = parseEmail(value);
    return {
      emailLocal: parsed.status === "parsed" ? parsed.local : null,
      emailDomain: parsed.status === "parsed" ? parsed.domain : null,
      emailRootDomain: parsed.status === "parsed" ? parsed.rootDomain : null,
    };
  }
  if (type === "phone-number") {
    const parsed = parsePhone(value);
    return {
      phoneE164: parsed.status === "parsed" ? parsed.e164 : null,
      phoneCountry: parsed.status === "parsed" ? parsed.country : null,
    };
  }
  if (type === "domain") {
    return { domainRoot: rootDomainOf(value) };
  }
  const parsed = parsePersonalName(value);
  return {
    nameFirst: parsed.status === "parsed" ? parsed.first : null,
    nameLast: parsed.status === "parsed" ? parsed.last : null,
  };
}
