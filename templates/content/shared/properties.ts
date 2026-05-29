export const EDITABLE_DOCUMENT_PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "person",
  "place",
  "files_media",
  "checkbox",
  "url",
  "email",
  "phone",
] as const;

export const COMPUTED_DOCUMENT_PROPERTY_TYPES = [
  "formula",
  "id",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
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
  formula?: string;
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
  person: "Person",
  place: "Place",
  files_media: "Files & media",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  formula: "Formula",
  id: "ID",
  created_time: "Created time",
  created_by: "Created by",
  last_edited_time: "Last edited time",
  last_edited_by: "Last edited by",
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

  if (type === "formula") {
    return { formula: "" };
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
      formula: typeof parsed.formula === "string" ? parsed.formula : undefined,
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
    case "files_media":
      return Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value)
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    case "text":
    case "select":
    case "status":
    case "date":
    case "person":
    case "place":
    case "url":
    case "email":
    case "phone":
      return String(value);
  }
}

export function formulaValueText(value: DocumentPropertyValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function evaluatePropertyFormula(
  formula: string | null | undefined,
  valuesByName: Record<string, DocumentPropertyValue>,
): DocumentPropertyValue {
  const trimmed = formula?.trim() ?? "";
  if (!trimmed) return null;

  const expression = trimmed.replace(/\{([^{}]+)\}/g, (_match, name) => {
    const value = valuesByName[String(name).trim()];
    const numericValue = Number(formulaValueText(value));
    return Number.isFinite(numericValue) ? String(numericValue) : "NaN";
  });
  const numericValue = evaluateNumericExpression(expression);
  if (numericValue !== null) return numericValue;

  return trimmed.replace(/\{([^{}]+)\}/g, (_match, name) =>
    formulaValueText(valuesByName[String(name).trim()]),
  );
}

export function evaluateNumericExpression(expression: string): number | null {
  const tokens = tokenizeNumericExpression(expression);
  if (!tokens) return null;
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume(expected?: string) {
    const token = tokens[index];
    if (expected && token !== expected) return null;
    index += 1;
    return token;
  }

  function parseFactor(): number | null {
    const token = peek();
    if (token === "+" || token === "-") {
      consume();
      const value = parseFactor();
      if (value === null) return null;
      return token === "-" ? -value : value;
    }
    if (token === "(") {
      consume("(");
      const value = parseExpression();
      if (value === null || consume(")") === null) return null;
      return value;
    }
    if (!token || Number.isNaN(Number(token))) return null;
    consume();
    return Number(token);
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value === null) return null;

    while (peek() === "*" || peek() === "/") {
      const operator = consume();
      const right = parseFactor();
      if (right === null) return null;
      value = operator === "*" ? value * right : value / right;
    }

    return value;
  }

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value === null) return null;

    while (peek() === "+" || peek() === "-") {
      const operator = consume();
      const right = parseTerm();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  const result = parseExpression();
  if (result === null || index !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

function tokenizeNumericExpression(expression: string): string[] | null {
  const tokens: string[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ("+-*/()".includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push(numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }
    return null;
  }

  return tokens.length > 0 ? tokens : null;
}
