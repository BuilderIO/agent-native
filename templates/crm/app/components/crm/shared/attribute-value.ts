import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
  type CrmAttributeType,
} from "../../../../shared/crm-attributes";
import type { CrmAttributeOption } from "../../../../shared/crm-contract";

export type CrmAttributeValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { [key: string]: unknown };

export type CrmEditableValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>;

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
  inputType: "text" | "number" | "email" | "tel" | "date" | "datetime-local";
  format(value: CrmAttributeValue, ctx: CrmValueContext): string;
  copy?(value: CrmAttributeValue, ctx: CrmValueContext): string;
  parse(text: string, ctx: CrmValueContext): CrmValueParse;
}

export function activeOptions(attribute: CrmValueShape): CrmAttributeOption[] {
  return (attribute.options ?? []).filter((option) => !option.archived);
}

export function resolveOption(
  attribute: CrmValueShape,
  value: unknown,
): CrmAttributeOption | undefined {
  if (typeof value !== "string") return undefined;
  return attribute.options?.find((option) => option.value === value);
}

export interface CrmValueToken {
  label: string;
  color?: string;
}

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

function asDisplayString(value: CrmAttributeValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

export function toDateInputValue(value: CrmAttributeValue | undefined): string {
  if (typeof value !== "string" || !value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}

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
    return `${value} ${code}`;
  }
}

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

export function editorInputType(attribute: CrmValueShape): {
  type: CrmValueSpec["inputType"];
  inputMode?: "decimal";
} {
  if (attribute.multi) return { type: "text" };
  const spec = valueSpecFor(attribute);
  if (spec.inputType === "number") {
    return { type: "text", inputMode: "decimal" };
  }
  return { type: spec.inputType };
}

const REFERENCE_OBJECT_KINDS: Record<string, string> = {
  accounts: "account",
  people: "person",
  opportunities: "opportunity",
};

/**
 * The record kind a reference picker may narrow its search to, read from
 * `config.reference.allowedObjectTypes`.
 *
 * `null` means "do not narrow": either the attribute declares no scope, or it
 * declares several object types, which `list-crm-records` takes one `kind` at a
 * time and cannot express. Picking one of several would hide exactly the record
 * the user is looking for, so an unexpressible scope stays open and the picker
 * says which types the attribute accepts.
 */
export function referenceSearchKind(attribute: CrmValueShape): string | null {
  const reference = attribute.config?.reference;
  if (!reference || typeof reference !== "object") return null;
  const allowed = (reference as { allowedObjectTypes?: unknown })
    .allowedObjectTypes;
  if (!Array.isArray(allowed) || allowed.length !== 1) return null;
  const objectType = allowed[0];
  if (typeof objectType !== "string") return null;
  return REFERENCE_OBJECT_KINDS[objectType] ?? null;
}

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

export interface CrmEditorDraft {
  draft: string;
  seed: string;
}

export function editorDraftFor(
  state: CrmEditorDraft | undefined,
  seed: string,
): CrmEditorDraft {
  if (!state) return { draft: seed, seed };
  return state.seed === seed ? state : { draft: seed, seed };
}

export function referenceMembers(
  value: CrmAttributeValue | undefined,
): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry !== "");
}

export function toggleReferenceValue(
  value: CrmAttributeValue | undefined,
  pick: string,
  multi: boolean,
): CrmEditableValue {
  if (!multi) return pick;
  const members = referenceMembers(value);
  const next = members.includes(pick)
    ? members.filter((entry) => entry !== pick)
    : [...members, pick];
  return next.length ? next : null;
}

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
