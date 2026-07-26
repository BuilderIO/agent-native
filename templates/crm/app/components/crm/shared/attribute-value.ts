/**
 * The one per-attribute-type value registry, shared by the spreadsheet grid and
 * the record page's attribute panel.
 *
 * It owns everything about a value that is not layout: display text, clipboard
 * text, parsing typed input back, resolving managed options and their colours,
 * and which editing *affordance* a type calls for. It deliberately stops there.
 * A grid cell is 34px tall, keyboard-driven, and edited in place; a panel row is
 * full width, labelled, and stacked — so each surface renders the affordance in
 * its own layout wrapper and only the value logic lives here.
 *
 * Adding an attribute type means adding one entry to `ATTRIBUTE_VALUE_SPECS`.
 */

import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
  type CrmAttributeType,
} from "../../../../shared/crm-attributes";
import type { CrmAttributeOption } from "../../../../shared/crm-contract";

/**
 * Every shape a stored CRM value can arrive in. Deliberately wider than either
 * surface's own value type so both can pass their values straight in.
 */
export type CrmAttributeValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { [key: string]: unknown };

/** Everything a typed editor can produce — assignable to both surfaces' types. */
export type CrmEditableValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>;

/**
 * The editing affordance a type calls for. `none` means no surface can edit it:
 * a system-only or composite type is read-only everywhere, not read-only by
 * accident in one place.
 */
export type CrmAttributeControl =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "options"
  | "rating"
  | "reference"
  | "none";

export type CrmValueParseFailure =
  | "not-a-number"
  | "not-a-date"
  | "unknown-option"
  | "read-only";

export type CrmValueParse =
  | { ok: true; value: CrmEditableValue }
  | { ok: false; reason: CrmValueParseFailure; detail?: string };

/** The attribute subset the registry needs; both surfaces' types satisfy it. */
export interface CrmValueShape {
  attributeType: CrmAttributeType;
  multi: boolean;
  options?: CrmAttributeOption[];
  config?: Record<string, unknown>;
}

export interface CrmValueContext {
  attribute: CrmValueShape;
  locale?: string;
}

export interface CrmValueSpec {
  control: CrmAttributeControl;
  align: "left" | "right" | "center";
  /**
   * `<input type>` for a single-valued text editor. The grid overrides it for
   * numbers — spinner arrows in a 34px cell hijack the scroll wheel — but the
   * semantic type belongs to the attribute type, so it is declared once here.
   */
  inputType: "text" | "number" | "email" | "tel" | "date" | "datetime-local";
  /** Display text for one scalar value. Empty string means "no value". */
  format(value: CrmAttributeValue, ctx: CrmValueContext): string;
  /** Text for one scalar in a clipboard copy. Defaults to `format`. */
  copy?(value: CrmAttributeValue, ctx: CrmValueContext): string;
  /** Read one scalar back from editor text or a pasted cell. */
  parse(text: string, ctx: CrmValueContext): CrmValueParse;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Option rows a picker may offer and a write may name — the server rejects the rest. */
export function activeOptions(attribute: CrmValueShape): CrmAttributeOption[] {
  return (attribute.options ?? []).filter((option) => !option.archived);
}

/**
 * The option a stored value refers to, archived included: a value written
 * before the option was archived still has to render with its own title.
 */
export function resolveOption(
  attribute: CrmValueShape,
  value: unknown,
): CrmAttributeOption | undefined {
  if (typeof value !== "string") return undefined;
  return attribute.options?.find((option) => option.value === value);
}

/** A rendered chip: a label and, when the option declares one, its colour. */
export interface CrmValueToken {
  label: string;
  color?: string;
}

/**
 * One token per value member. Both surfaces render option chips from this —
 * they differ only in the wrapper, not in what a chip says.
 */
export function valueTokens(
  attribute: CrmValueShape,
  value: CrmAttributeValue | undefined,
): CrmValueToken[] {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  const usesOptions = ATTRIBUTE_TYPE_SPECS[attribute.attributeType].usesOptions;
  const tokens: CrmValueToken[] = [];
  for (const entry of entries) {
    if (entry === null || entry === undefined) continue;
    const option = usesOptions ? resolveOption(attribute, entry) : undefined;
    if (option) {
      tokens.push(
        option.color
          ? { label: option.title, color: option.color }
          : { label: option.title },
      );
      continue;
    }
    tokens.push({
      label: typeof entry === "object" ? JSON.stringify(entry) : String(entry),
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Shared coercions
// ---------------------------------------------------------------------------

function asDisplayString(value: CrmAttributeValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

/** ISO date (`2026-01-31`) from an ISO date or timestamp; "" when unreadable. */
export function toDateInputValue(value: CrmAttributeValue | undefined): string {
  if (typeof value !== "string" || !value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}

/** `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`; "" when unreadable. */
export function toDateTimeInputValue(
  value: CrmAttributeValue | undefined,
): string {
  if (typeof value !== "string" || !value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(
    parsed.getDate(),
  )}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** The ISO 4217 code an attribute declares, normalised; null when unusable. */
export function currencyCodeOf(
  config: Record<string, unknown> | undefined,
): string | null {
  const currency = config?.currency;
  if (!currency || typeof currency !== "object") return null;
  const code = (currency as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code)
    ? code.toUpperCase()
    : null;
}

function formatCurrency(
  value: number,
  code: string | null,
  locale: string | undefined,
): string {
  if (!code) return String(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unsupported code is a configuration problem, not a reason to hide the
    // amount: show the raw number next to the code the attribute declares.
    return `${value} ${code}`;
  }
}

// ---------------------------------------------------------------------------
// Per-type specs
// ---------------------------------------------------------------------------

/** Ratings are a fixed five-star scale; the parser and both surfaces share it. */
export const RATING_MAX = 5;

const TEXT_SPEC: CrmValueSpec = {
  control: "text",
  align: "left",
  inputType: "text",
  format: asDisplayString,
  parse: (text) => ({ ok: true, value: text.trim() === "" ? null : text }),
};

function numberSpec(overrides: Partial<CrmValueSpec> = {}): CrmValueSpec {
  return {
    control: "number",
    align: "right",
    inputType: "number",
    format: (value) => (typeof value === "number" ? String(value) : ""),
    parse: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: true, value: null };
      // `Number("")` is 0 and `Number("12abc")` is NaN — both would otherwise
      // land in the field as a confident wrong number.
      const parsed = Number(trimmed.replace(/[\s,]/g, ""));
      if (!Number.isFinite(parsed)) {
        return { ok: false, reason: "not-a-number", detail: trimmed };
      }
      return { ok: true, value: parsed };
    },
    ...overrides,
  };
}

function optionSpec(): CrmValueSpec {
  return {
    control: "options",
    align: "left",
    inputType: "text",
    format: (value, ctx) => {
      const raw = asDisplayString(value);
      if (!raw) return "";
      return resolveOption(ctx.attribute, raw)?.title ?? raw;
    },
    // Copy the stored value, not the title: a clipboard round-trip has to paste
    // back through `parse`, which matches on option value first.
    copy: (value) => asDisplayString(value),
    parse: (text, ctx) => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: true, value: null };
      const options = activeOptions(ctx.attribute);
      const match =
        options.find((option) => option.value === trimmed) ??
        options.find(
          (option) => option.title.toLowerCase() === trimmed.toLowerCase(),
        );
      // Managed options are a closed set, and the writer resolves them against
      // non-archived rows only. Refusing here keeps a doomed write off the wire.
      if (!match)
        return { ok: false, reason: "unknown-option", detail: trimmed };
      return { ok: true, value: match.value };
    },
  };
}

function referenceSpec(): CrmValueSpec {
  return {
    control: "reference",
    align: "left",
    inputType: "text",
    format: asDisplayString,
    parse: (text) => ({ ok: true, value: text.trim() === "" ? null : text }),
  };
}

function readOnlySpec(format: CrmValueSpec["format"]): CrmValueSpec {
  return {
    control: "none",
    align: "left",
    inputType: "text",
    format,
    parse: () => ({ ok: false, reason: "read-only" }),
  };
}

function formatLocation(value: CrmAttributeValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return asDisplayString(value);
  }
  const parts = ["locality", "region", "country"]
    .map((key) => (value as Record<string, unknown>)[key])
    .filter((part): part is string => typeof part === "string" && part !== "");
  return parts.length ? parts.join(", ") : JSON.stringify(value);
}

function formatInteraction(value: CrmAttributeValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return asDisplayString(value);
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const at = typeof record.occurredAt === "string" ? record.occurredAt : "";
  return [type, at].filter(Boolean).join(" · ") || JSON.stringify(value);
}

export const ATTRIBUTE_VALUE_SPECS: Record<CrmAttributeType, CrmValueSpec> = {
  text: TEXT_SPEC,
  number: numberSpec(),
  checkbox: {
    control: "checkbox",
    align: "center",
    inputType: "text",
    format: (value) =>
      value === true ? "true" : value === false ? "false" : "",
    parse: (text) => {
      const trimmed = text.trim().toLowerCase();
      if (!trimmed) return { ok: true, value: null };
      if (["true", "yes", "1", "y"].includes(trimmed)) {
        return { ok: true, value: true };
      }
      if (["false", "no", "0", "n"].includes(trimmed)) {
        return { ok: true, value: false };
      }
      return { ok: false, reason: "not-a-number", detail: trimmed };
    },
  },
  currency: numberSpec({
    format: (value, ctx) =>
      typeof value === "number"
        ? formatCurrency(
            value,
            currencyCodeOf(ctx.attribute.config),
            ctx.locale,
          )
        : "",
    // A formatted "$1,200.00" cannot be read back as a number reliably, so both
    // the clipboard and the editor seed carry the raw amount.
    copy: (value) => (typeof value === "number" ? String(value) : ""),
  }),
  date: {
    control: "date",
    align: "left",
    inputType: "date",
    format: (value) => toDateInputValue(value),
    parse: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: true, value: null };
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, reason: "not-a-date", detail: trimmed };
      }
      return { ok: true, value: parsed.toISOString().slice(0, 10) };
    },
  },
  timestamp: {
    control: "datetime",
    align: "left",
    inputType: "datetime-local",
    format: (value, ctx) => {
      if (typeof value !== "string" || !value) return "";
      const parsed = new Date(value);
      // An unreadable stored timestamp shows its raw text rather than a blank
      // field: blank would read as "no value".
      return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleString(ctx.locale);
    },
    copy: (value) => asDisplayString(value),
    parse: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: true, value: null };
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, reason: "not-a-date", detail: trimmed };
      }
      return { ok: true, value: parsed.toISOString() };
    },
  },
  rating: numberSpec({
    control: "rating",
    parse: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: true, value: null };
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > RATING_MAX) {
        return { ok: false, reason: "not-a-number", detail: trimmed };
      }
      return { ok: true, value: Math.round(parsed) };
    },
  }),
  status: optionSpec(),
  select: optionSpec(),
  "record-reference": referenceSpec(),
  "actor-reference": referenceSpec(),
  location: readOnlySpec(formatLocation),
  domain: TEXT_SPEC,
  "email-address": { ...TEXT_SPEC, inputType: "email" },
  "phone-number": { ...TEXT_SPEC, inputType: "tel" },
  interaction: readOnlySpec(formatInteraction),
  "personal-name": readOnlySpec(asDisplayString),
};

export function valueSpecFor(attribute: CrmValueShape): CrmValueSpec {
  return ATTRIBUTE_VALUE_SPECS[attribute.attributeType];
}

/** Every type has a spec and no system-only type is editable anywhere. */
export function assertValueRegistryComplete(): void {
  for (const type of CRM_ATTRIBUTE_TYPES) {
    const spec = ATTRIBUTE_VALUE_SPECS[type];
    if (!spec) {
      throw new Error(`CRM has no value spec for attribute type "${type}".`);
    }
    if (ATTRIBUTE_TYPE_SPECS[type].systemOnly && spec.control !== "none") {
      throw new Error(
        `CRM must render system-only attribute type "${type}" read-only.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-value handling
// ---------------------------------------------------------------------------

function scalarsOf(value: CrmAttributeValue): CrmAttributeValue[] {
  return Array.isArray(value) ? value : value === null ? [] : [value];
}

function contextFor(
  attribute: CrmValueShape,
  locale: string | undefined,
): CrmValueContext {
  return { attribute, ...(locale ? { locale } : {}) };
}

export function formatAttributeValue(
  attribute: CrmValueShape,
  value: CrmAttributeValue,
  locale?: string,
): string {
  const spec = valueSpecFor(attribute);
  const ctx = contextFor(attribute, locale);
  if (!attribute.multi) return spec.format(value, ctx);
  return scalarsOf(value)
    .map((entry) => spec.format(entry, ctx))
    .filter((entry) => entry !== "")
    .join(", ");
}

export function copyAttributeValue(
  attribute: CrmValueShape,
  value: CrmAttributeValue,
  locale?: string,
): string {
  const spec = valueSpecFor(attribute);
  const ctx = contextFor(attribute, locale);
  const one = (entry: CrmAttributeValue) =>
    spec.copy ? spec.copy(entry, ctx) : spec.format(entry, ctx);
  if (!attribute.multi) return one(value);
  return scalarsOf(value)
    .map(one)
    .filter((entry) => entry !== "")
    .join(", ");
}

/**
 * Read editor text or a pasted cell back into a storable value. A multi-valued
 * attribute splits on commas; one bad member fails the whole value rather than
 * dropping that member.
 */
export function parseAttributeValue(
  attribute: CrmValueShape,
  text: string,
  locale?: string,
): CrmValueParse {
  const spec = valueSpecFor(attribute);
  const ctx = contextFor(attribute, locale);
  if (!attribute.multi) return spec.parse(text, ctx);
  const members = text
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member !== "");
  if (members.length === 0) return { ok: true, value: null };
  const values: Array<string | number | boolean> = [];
  for (const member of members) {
    const parsed = spec.parse(member, ctx);
    if (!parsed.ok) return parsed;
    if (parsed.value === null) continue;
    if (
      typeof parsed.value !== "string" &&
      typeof parsed.value !== "number" &&
      typeof parsed.value !== "boolean"
    ) {
      return { ok: false, reason: "read-only", detail: member };
    }
    values.push(parsed.value);
  }
  return { ok: true, value: values.length ? values : null };
}

/**
 * The raw text an editor starts from. Never the formatted display text: a
 * currency cell seeded with "$1,200.00" cannot be parsed back into 1200.
 */
export function attributeInputValue(
  attribute: CrmValueShape,
  value: CrmAttributeValue | undefined,
): string {
  if (value === undefined || value === null) return "";
  const control = valueSpecFor(attribute).control;
  if (!attribute.multi && control === "date") return toDateInputValue(value);
  if (!attribute.multi && control === "datetime") {
    return toDateTimeInputValue(value);
  }
  if (Array.isArray(value))
    return value.map((entry) => String(entry)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Days a value has sat past its status option's `targetDays`. `null` when the
 * attribute is not a status, has no SLA, or has no known `activeFrom` — an
 * unknown age is not an on-time one.
 */
export function statusOverrunDays(input: {
  attribute: CrmValueShape;
  value: CrmAttributeValue;
  since: string | undefined;
  now?: Date;
}): number | null {
  if (input.attribute.attributeType !== "status") return null;
  if (typeof input.value !== "string" || !input.value) return null;
  if (!input.since) return null;
  const targetDays = resolveOption(input.attribute, input.value)?.targetDays;
  if (typeof targetDays !== "number" || targetDays <= 0) return null;
  const since = new Date(input.since);
  if (Number.isNaN(since.getTime())) return null;
  const now = input.now ?? new Date();
  const elapsedDays = (now.getTime() - since.getTime()) / 86_400_000;
  const overrun = elapsedDays - targetDays;
  return overrun > 0 ? Math.floor(overrun) : null;
}
