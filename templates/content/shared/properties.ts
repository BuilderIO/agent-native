export const EDITABLE_DOCUMENT_PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
] as const;

export const COMPUTED_DOCUMENT_PROPERTY_TYPES = [
  "id",
  "created_time",
  "created_by",
  "last_edited_time",
] as const;

export const DOCUMENT_PROPERTY_TYPES = [
  ...EDITABLE_DOCUMENT_PROPERTY_TYPES,
  ...COMPUTED_DOCUMENT_PROPERTY_TYPES,
] as const;

export type EditableDocumentPropertyType =
  (typeof EDITABLE_DOCUMENT_PROPERTY_TYPES)[number];

export type ComputedDocumentPropertyType =
  (typeof COMPUTED_DOCUMENT_PROPERTY_TYPES)[number];

export type DocumentPropertyType = (typeof DOCUMENT_PROPERTY_TYPES)[number];

export const DOCUMENT_PROPERTY_VISIBILITIES = [
  "always_show",
  "hide_when_empty",
  "always_hide",
] as const;

export type DocumentPropertyVisibility =
  (typeof DOCUMENT_PROPERTY_VISIBILITIES)[number];

export type DocumentPropertyOptionColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export interface DocumentPropertyOption {
  id: string;
  name: string;
  color: DocumentPropertyOptionColor;
}

export interface DocumentPropertyOptions {
  options?: DocumentPropertyOption[];
}

export type DocumentPropertyValue = string | number | boolean | string[] | null;

export const DOCUMENT_PROPERTY_TYPE_LABELS: Record<
  DocumentPropertyType,
  string
> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  id: "ID",
  created_time: "Created time",
  created_by: "Created by",
  last_edited_time: "Last edited time",
};

export const DOCUMENT_PROPERTY_VISIBILITY_LABELS: Record<
  DocumentPropertyVisibility,
  string
> = {
  always_show: "Always show",
  hide_when_empty: "Hide when empty",
  always_hide: "Always hide",
};

export function isComputedPropertyType(
  type: DocumentPropertyType,
): type is ComputedDocumentPropertyType {
  return (COMPUTED_DOCUMENT_PROPERTY_TYPES as readonly string[]).includes(type);
}

export function defaultPropertyOptions(
  type: DocumentPropertyType,
): DocumentPropertyOptions {
  if (type === "status") {
    return {
      options: [
        { id: "not-started", name: "Not started", color: "gray" },
        { id: "in-progress", name: "In progress", color: "blue" },
        { id: "done", name: "Done", color: "green" },
      ],
    };
  }

  if (type === "select" || type === "multi_select") {
    return {
      options: [{ id: "option", name: "Option", color: "gray" }],
    };
  }

  return {};
}

export function parsePropertyOptions(
  value: string | null | undefined,
): DocumentPropertyOptions {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as DocumentPropertyOptions;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      ...parsed,
      options: Array.isArray(parsed.options) ? parsed.options : undefined,
    };
  } catch {
    return {};
  }
}

export function serializePropertyOptions(
  value: DocumentPropertyOptions | null | undefined,
): string {
  return JSON.stringify(value ?? {});
}

export function parsePropertyValue(
  value: string | null | undefined,
): DocumentPropertyValue {
  if (!value) return null;
  try {
    return JSON.parse(value) as DocumentPropertyValue;
  } catch {
    return null;
  }
}

export function serializePropertyValue(value: DocumentPropertyValue): string {
  return JSON.stringify(value);
}

export function normalizePropertyVisibility(
  value: unknown,
): DocumentPropertyVisibility {
  return DOCUMENT_PROPERTY_VISIBILITIES.includes(
    value as DocumentPropertyVisibility,
  )
    ? (value as DocumentPropertyVisibility)
    : "always_show";
}

export function isEmptyPropertyValue(value: DocumentPropertyValue): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function normalizePropertyValue(
  type: DocumentPropertyType,
  value: unknown,
): DocumentPropertyValue {
  if (isComputedPropertyType(type)) return null;
  if (value === undefined || value === null || value === "") return null;

  switch (type) {
    case "number": {
      const numberValue =
        typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(numberValue) ? numberValue : null;
    }
    case "checkbox": {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["false", "0", "off", "no", "unchecked"].includes(normalized)) {
          return false;
        }
      }
      return Boolean(value);
    }
    case "multi_select":
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    case "text":
    case "select":
    case "status":
    case "date":
    case "url":
    case "email":
    case "phone":
      return String(value);
  }
}
