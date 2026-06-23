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
  "relation",
  // Capacities-style rich-text body field. Each Blocks field is its OWN
  // independent content (NOT an alias of the page body). The default "Content"
  // field is backed by `documents.content`; additional Blocks fields each get
  // their own row in `document_block_field_contents`.
  "blocks",
] as const;

export const COMPUTED_DOCUMENT_PROPERTY_TYPES = [
  "formula",
  "rollup",
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

export const CREATABLE_DOCUMENT_PROPERTY_TYPES = [
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
  "blocks",
  "id",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
] as const satisfies readonly DocumentPropertyType[];

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
  relation?: {
    databaseId?: string | null;
  };
  // Set on the default/primary "Content" Blocks field. The primary field is the
  // one whose content is backed by `documents.content` (the page body editor).
  // Exactly one Blocks field per database should be primary; additional Blocks
  // fields store their content independently in `document_block_field_contents`.
  blocks?: {
    primary?: boolean;
  };
  rollup?: {
    relationPropertyId?: string | null;
    targetPropertyId?: string | null;
    aggregation?:
      | "count"
      | "count_values"
      | "count_unique"
      | "sum"
      | "average"
      | "min"
      | "max";
  };
}

export interface DocumentPropertyDateValue {
  start: string;
  end?: string | null;
  includeTime?: boolean;
}

export type DocumentPropertyValue =
  | string
  | number
  | boolean
  | string[]
  | DocumentPropertyDateValue
  | null;

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
  relation: "Relation",
  blocks: "Blocks",
  formula: "Formula",
  rollup: "Rollup",
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

// The default name a database's seeded Blocks field gets.
export const DEFAULT_BLOCKS_FIELD_NAME = "Content";

export function isBlocksPropertyType(type: DocumentPropertyType): boolean {
  return type === "blocks";
}

// The primary Blocks field is the one backed by `documents.content`. There is
// at most one per database; it is the field seeded by default and is what the
// page-body editor reads/writes.
export function isPrimaryBlocksField(
  options: DocumentPropertyOptions,
): boolean {
  return options.blocks?.primary === true;
}

// Word count for a Blocks field's markdown content. Strips the lightest layer
// of markdown punctuation so a "412 words" table cell reflects prose, not
// syntax. Kept dependency-free because `shared/properties` is bundled into the
// browser.
export function countWords(content: string | null | undefined): number {
  const text = (content ?? "")
    // Drop fenced code blocks wholesale — they're not prose.
    .replace(/```[\s\S]*?```/g, " ")
    // Strip inline/other markdown punctuation that would split or pad tokens.
    .replace(/[#>*_`~\-+=|[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(" ").filter(Boolean).length;
}

// "412 words" / "1 word" / "Empty" for table cells.
export function formatWordCount(content: string | null | undefined): string {
  const count = countWords(content);
  if (count === 0) return "Empty";
  return `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
}

// Render decision for a set of Blocks-field types on one row:
// - 0 or 1 Blocks field → "solo" (chromeless: no header, just the body).
// - 2+                  → "multi" (each field gets a header + is collapsible).
export function blocksRenderMode(blocksFieldCount: number): "solo" | "multi" {
  return blocksFieldCount >= 2 ? "multi" : "solo";
}

// Whether deleting a property triggers the "only Blocks field" warning — i.e.
// it is a Blocks field and it is the last one in the type, so removing it drops
// the body for every object of this type.
export function isOnlyBlocksFieldDeletion(args: {
  type: DocumentPropertyType;
  blocksFieldCount: number;
}): boolean {
  return isBlocksPropertyType(args.type) && args.blocksFieldCount <= 1;
}

// Where a Blocks field's content is stored. The primary "Content" field lives
// on `documents.content` (the body); every other Blocks field has its own row
// in the block-field content store. This single decision keeps reads and writes
// in lockstep and guarantees no two fields ever share a backing location.
export type BlocksStorageTarget = "document_body" | "block_field_store";

export function blocksStorageTarget(
  options: DocumentPropertyOptions,
): BlocksStorageTarget {
  return isPrimaryBlocksField(options) ? "document_body" : "block_field_store";
}

// Resolve a Blocks field's value for one row given the document body and the
// (additional) block-field content store. Each field reads from exactly one
// place — the primary from the body, others from their own keyed entry — so two
// Blocks fields can never resolve to the same content.
export function resolveBlocksFieldValue(args: {
  options: DocumentPropertyOptions;
  documentBody: string | null | undefined;
  blockFieldContent: string | null | undefined;
}): string {
  return blocksStorageTarget(args.options) === "document_body"
    ? (args.documentBody ?? "")
    : (args.blockFieldContent ?? "");
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

  if (type === "relation") {
    return { relation: { databaseId: null } };
  }

  if (type === "rollup") {
    return {
      rollup: {
        relationPropertyId: null,
        targetPropertyId: null,
        aggregation: "count",
      },
    };
  }

  // A manually-added Blocks field is independent (non-primary). The seeded
  // default "Content" field is marked primary explicitly at seed time.
  if (type === "blocks") {
    return { blocks: { primary: false } };
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
      relation:
        parsed.relation && typeof parsed.relation === "object"
          ? {
              databaseId:
                typeof parsed.relation.databaseId === "string"
                  ? parsed.relation.databaseId
                  : null,
            }
          : undefined,
      blocks:
        parsed.blocks && typeof parsed.blocks === "object"
          ? { primary: parsed.blocks.primary === true }
          : undefined,
      rollup:
        parsed.rollup && typeof parsed.rollup === "object"
          ? {
              relationPropertyId:
                typeof parsed.rollup.relationPropertyId === "string"
                  ? parsed.rollup.relationPropertyId
                  : null,
              targetPropertyId:
                typeof parsed.rollup.targetPropertyId === "string"
                  ? parsed.rollup.targetPropertyId
                  : null,
              aggregation: normalizeRollupAggregation(
                parsed.rollup.aggregation,
              ),
            }
          : undefined,
    };
  } catch {
    return {};
  }
}

export function normalizeRollupAggregation(
  value: unknown,
): NonNullable<DocumentPropertyOptions["rollup"]>["aggregation"] {
  return value === "count_values" ||
    value === "count_unique" ||
    value === "sum" ||
    value === "average" ||
    value === "min" ||
    value === "max"
    ? value
    : "count";
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
  if (isDocumentPropertyDateValue(value)) return !value.start.trim();
  return false;
}

export function isDocumentPropertyDateValue(
  value: unknown,
): value is DocumentPropertyDateValue {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "start" in value &&
    typeof (value as { start?: unknown }).start === "string"
  );
}

export function documentPropertyDatePart(
  value: unknown,
  part: "start" | "end",
) {
  if (isDocumentPropertyDateValue(value)) {
    const rawValue = part === "start" ? value.start : value.end;
    return typeof rawValue === "string" ? rawValue.trim() : "";
  }
  if (part === "end") return "";
  if (typeof value === "string") return value.trim();
  return "";
}

export function documentPropertyDateIncludesTime(value: unknown) {
  if (isDocumentPropertyDateValue(value)) return value.includeTime === true;
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim());
}

export function documentPropertyDateKey(
  value: unknown,
  part: "start" | "end" = "start",
) {
  const rawValue = documentPropertyDatePart(value, part);
  if (!rawValue) return null;
  const dateOnly = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDatePropertyValue(
  value: unknown,
): DocumentPropertyDateValue | null {
  if (value === undefined || value === null || value === "") return null;

  // Accept epoch timestamps (e.g. Builder CMS date fields come back as
  // milliseconds-since-epoch numbers) by coercing to an ISO string first.
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = new Date(value);
    if (Number.isNaN(epoch.getTime())) return null;
    value = epoch.toISOString();
  }

  const includeTime = documentPropertyDateIncludesTime(value);
  const start = documentPropertyDatePart(value, "start");
  const end = documentPropertyDatePart(value, "end");
  const normalizedStart = normalizeDatePropertyPart(start, includeTime);
  if (!normalizedStart) return null;

  const normalizedEnd = normalizeDatePropertyPart(end, includeTime);
  const next: DocumentPropertyDateValue = {
    start: normalizedStart,
    includeTime,
  };
  const startKey = documentPropertyDateKey(normalizedStart);
  const endKey = normalizedEnd ? documentPropertyDateKey(normalizedEnd) : null;
  if (normalizedEnd && startKey && endKey && endKey >= startKey) {
    next.end = normalizedEnd;
  }
  return next;
}

function normalizeDatePropertyPart(value: string, includeTime: boolean) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (match) {
    const dateOnly = `${match[1]}-${match[2]}-${match[3]}`;
    if (!includeTime) return dateOnly;
    return `${dateOnly}T${match[4] ?? "00"}:${match[5] ?? "00"}`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (!includeTime) return `${year}-${month}-${day}`;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
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
    case "person":
    case "relation":
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
    case "place":
    case "url":
    case "email":
    case "phone":
    // A Blocks field's value is its markdown content — a plain string, same
    // shape as `documents.content`.
    case "blocks":
      return String(value);
    case "date":
      return normalizeDatePropertyValue(value);
  }
}

export function formulaValueText(value: DocumentPropertyValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (isDocumentPropertyDateValue(value)) {
    const start = value.start.trim();
    const end = value.end?.trim();
    return end ? `${start} - ${end}` : start;
  }
  return String(value);
}

export function evaluatePropertyFormula(
  formula: string | null | undefined,
  valuesByName: Record<string, DocumentPropertyValue>,
): DocumentPropertyValue {
  const trimmed = formula?.trim() ?? "";
  if (!trimmed) return null;

  const formulaValue = evaluateFormulaExpression(trimmed, valuesByName);
  if (formulaValue !== null) return formulaValue;

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

/**
 * Evaluate a source-key normalization formula into its canonical-key string.
 *
 * Unlike `evaluatePropertyFormula`, this does NOT fall back to literal
 * `{token}` substitution when the expression yields null — a broken or
 * null-producing formula returns `null` (an un-joinable key) so it fails
 * visibly as "no match" instead of silently producing a garbage key. An empty
 * result also collapses to `null`, so empty keys never match each other.
 */
export function evaluateNormalizationFormula(
  formula: string | null | undefined,
  valuesByName: Record<string, DocumentPropertyValue>,
): string | null {
  const trimmed = sanitizeNormalizationFormula(formula);
  if (!trimmed) return null;
  const value = evaluateFormulaExpression(trimmed, valuesByName);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

type FormulaPrimitive = string | number | boolean | null;

const MAX_NORMALIZATION_FORMULA_LENGTH = 1000;
const MAX_REGEX_PATTERN_LENGTH = 160;

type FormulaToken =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "property"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "punctuation"; value: "(" | ")" | "," };

function evaluateFormulaExpression(
  expression: string,
  valuesByName: Record<string, DocumentPropertyValue>,
): FormulaPrimitive {
  const tokensOrNull = tokenizeFormulaExpression(expression);
  if (!tokensOrNull) return null;
  const tokens = tokensOrNull;
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume() {
    const token = tokens[index];
    index += 1;
    return token;
  }

  function consumeValue(value: string) {
    const token = peek();
    if (!token || !("value" in token) || token.value !== value) return false;
    index += 1;
    return true;
  }

  function parseExpression(): FormulaPrimitive {
    return parseComparison();
  }

  function parseComparison(): FormulaPrimitive {
    let left = parseAdditive();
    while (true) {
      const token = peek();
      if (
        token?.type !== "operator" ||
        ![">", ">=", "<", "<=", "==", "!="].includes(token.value)
      ) {
        return left;
      }
      consume();
      const right = parseAdditive();
      left = compareFormulaValues(left, right, token.value);
    }
  }

  function parseAdditive(): FormulaPrimitive {
    let left = parseMultiplicative();
    while (true) {
      const token = peek();
      if (token?.type !== "operator" || !["+", "-"].includes(token.value)) {
        return left;
      }
      consume();
      const right = parseMultiplicative();
      if (token.value === "+") {
        const leftNumber = formulaNumberValue(left);
        const rightNumber = formulaNumberValue(right);
        left =
          leftNumber !== null && rightNumber !== null
            ? leftNumber + rightNumber
            : typeof left === "string" || typeof right === "string"
              ? formulaTextValue(left) + formulaTextValue(right)
              : null;
      } else {
        left = numericFormulaOperation(left, right, (a, b) => a - b);
      }
    }
  }

  function parseMultiplicative(): FormulaPrimitive {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (token?.type !== "operator" || !["*", "/"].includes(token.value)) {
        return left;
      }
      consume();
      const right = parseUnary();
      left = numericFormulaOperation(left, right, (a, b) =>
        token.value === "*" ? a * b : a / b,
      );
    }
  }

  function parseUnary(): FormulaPrimitive {
    const token = peek();
    if (
      token?.type === "operator" &&
      (token.value === "+" || token.value === "-")
    ) {
      consume();
      const value = formulaNumberValue(parseUnary());
      if (value === null) return null;
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary(): FormulaPrimitive {
    const token = consume();
    if (!token) return null;
    if (token.type === "number" || token.type === "string") return token.value;
    if (token.type === "property") {
      return formulaPrimitiveValue(valuesByName[token.value.trim()]);
    }
    if (token.type === "punctuation" && token.value === "(") {
      const value = parseExpression();
      return consumeValue(")") ? value : null;
    }
    if (token.type !== "identifier") return null;

    const name = token.value.toLowerCase();
    if (name === "true") return true;
    if (name === "false") return false;
    if (!consumeValue("(")) return null;

    const args: FormulaPrimitive[] = [];
    if (!consumeValue(")")) {
      do {
        args.push(parseExpression());
      } while (consumeValue(","));
      if (!consumeValue(")")) return null;
    }
    return evaluateFormulaFunction(name, args);
  }

  const value = parseExpression();
  return index === tokens.length ? value : null;
}

function tokenizeFormulaExpression(expression: string): FormulaToken[] | null {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      const end = expression.indexOf("}", index + 1);
      if (end === -1) return null;
      tokens.push({
        type: "property",
        value: expression.slice(index + 1, end),
      });
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const parsed = readFormulaString(expression, index, char);
      if (!parsed) return null;
      tokens.push({ type: "string", value: parsed.value });
      index = parsed.nextIndex;
      continue;
    }
    if ("(),".includes(char)) {
      tokens.push({
        type: "punctuation",
        value: char as "(" | ")" | ",",
      });
      index += 1;
      continue;
    }
    const operator = expression.slice(index).match(/^(>=|<=|==|!=|[+\-*/<>])/);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }
    const identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    return null;
  }

  return tokens.length > 0 ? tokens : null;
}

function readFormulaString(
  expression: string,
  startIndex: number,
  quote: string,
) {
  let value = "";
  let index = startIndex + 1;
  while (index < expression.length) {
    const char = expression[index];
    if (char === "\\") {
      const next = expression[index + 1];
      if (!next) return null;
      value += next;
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    value += char;
    index += 1;
  }
  return null;
}

function formulaPrimitiveValue(value: DocumentPropertyValue): FormulaPrimitive {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  return formulaValueText(value);
}

function formulaNumberValue(value: FormulaPrimitive): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim()) {
    const numberValue = Number(value.trim());
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function formulaTextValue(value: FormulaPrimitive) {
  return value === null || value === undefined ? "" : String(value);
}

function formulaTruthy(value: FormulaPrimitive) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function numericFormulaOperation(
  left: FormulaPrimitive,
  right: FormulaPrimitive,
  operation: (left: number, right: number) => number,
): FormulaPrimitive {
  const leftNumber = formulaNumberValue(left);
  const rightNumber = formulaNumberValue(right);
  if (leftNumber === null || rightNumber === null) return null;
  const result = operation(leftNumber, rightNumber);
  return Number.isFinite(result) ? result : null;
}

function compareFormulaValues(
  left: FormulaPrimitive,
  right: FormulaPrimitive,
  operator: string,
): boolean {
  if (operator === "==" || operator === "!=") {
    const equal = formulaTextValue(left) === formulaTextValue(right);
    return operator === "==" ? equal : !equal;
  }

  const leftNumber = formulaNumberValue(left);
  const rightNumber = formulaNumberValue(right);
  if (leftNumber !== null && rightNumber !== null) {
    if (operator === ">") return leftNumber > rightNumber;
    if (operator === ">=") return leftNumber >= rightNumber;
    if (operator === "<") return leftNumber < rightNumber;
    return leftNumber <= rightNumber;
  }

  const leftText = formulaTextValue(left);
  const rightText = formulaTextValue(right);
  if (operator === ">") return leftText > rightText;
  if (operator === ">=") return leftText >= rightText;
  if (operator === "<") return leftText < rightText;
  return leftText <= rightText;
}

function evaluateFormulaFunction(
  name: string,
  args: FormulaPrimitive[],
): FormulaPrimitive {
  switch (name) {
    case "if":
      return formulaTruthy(args[0]) ? (args[1] ?? null) : (args[2] ?? null);
    case "concat":
      return args.map(formulaTextValue).join("");
    case "contains":
      return formulaTextValue(args[0]).includes(formulaTextValue(args[1]));
    case "empty":
      return !formulaTruthy(args[0]);
    case "not":
      return !formulaTruthy(args[0]);
    case "and":
      return args.every(formulaTruthy);
    case "or":
      return args.some(formulaTruthy);
    case "round":
    case "ceil":
    case "floor":
    case "abs": {
      const value = formulaNumberValue(args[0]);
      if (value === null) return null;
      if (name === "round") return Math.round(value);
      if (name === "ceil") return Math.ceil(value);
      if (name === "floor") return Math.floor(value);
      return Math.abs(value);
    }
    case "min":
    case "max": {
      const numbers = args
        .map(formulaNumberValue)
        .filter((value): value is number => value !== null);
      if (numbers.length !== args.length || numbers.length === 0) return null;
      return name === "min" ? Math.min(...numbers) : Math.max(...numbers);
    }
    case "length":
      return formulaTextValue(args[0]).length;
    case "lower":
      return formulaTextValue(args[0]).toLowerCase();
    case "upper":
      return formulaTextValue(args[0]).toUpperCase();
    case "trim":
      return formulaTextValue(args[0]).trim();
    case "replace": {
      const subject = formulaTextValue(args[0]);
      const find = formulaTextValue(args[1]);
      if (find === "") return subject;
      return subject.split(find).join(formulaTextValue(args[2]));
    }
    case "slug":
      return slugifyFormulaText(formulaTextValue(args[0]));
    case "striphost":
      return stripUrlHost(formulaTextValue(args[0]));
    case "regexextract":
      return regexExtractFormula(
        formulaTextValue(args[0]),
        formulaTextValue(args[1]),
        args.length > 2 ? formulaNumberValue(args[2]) : null,
      );
    case "regexreplace":
      return regexReplaceFormula(
        formulaTextValue(args[0]),
        formulaTextValue(args[1]),
        formulaTextValue(args[2]),
      );
    default:
      return null;
  }
}

// URL-style slug (lowercase, non-alphanumeric runs → "-", trimmed). Distinct
// from `slugifySourceField` in _database-source-utils, which slugs field *keys*
// with "_" — different output space, kept separate on purpose.
export function slugifyFormulaText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reduce a URL to its path so a host-qualified URL normalizes to the same key
// as a relative one.
function stripUrlHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const urlLike = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^[^/\s?#]+\.[^/\s?#]+(?:[/?#]|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : trimmed;
  try {
    const path = new URL(urlLike, "http://agent-native.local").pathname;
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  } catch {
    return trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function isSafeRegexPattern(pattern: string) {
  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false;
  if (/\(\?<?[=!]/.test(pattern)) return false;
  const quantifier = "(?:[+*]|\\{\\d+(?:,\\d*)?\\})";
  const nestedQuantifier = new RegExp(
    `\\((?:[^()\\\\]|\\\\.)*${quantifier}(?:[^()\\\\]|\\\\.)*\\)${quantifier}`,
  );
  if (nestedQuantifier.test(pattern)) return false;
  const quantifiedAlternation = new RegExp(
    `\\((?:[^()\\\\]|\\\\.)*\\|(?:[^()\\\\]|\\\\.)*\\)${quantifier}`,
  );
  if (quantifiedAlternation.test(pattern)) return false;
  return true;
}

function safeRegExp(pattern: string, flags = "") {
  if (!isSafeRegexPattern(pattern)) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function regexPatternStringsFromFormula(expression: string) {
  const tokens = tokenizeFormulaExpression(expression);
  if (!tokens) return null;
  const patterns: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.type !== "identifier" ||
      !["regexextract", "regexreplace"].includes(token.value.toLowerCase()) ||
      tokens[index + 1]?.type !== "punctuation" ||
      tokens[index + 1]?.value !== "("
    ) {
      continue;
    }
    let depth = 0;
    let argIndex = 0;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const inner = tokens[cursor];
      if (inner.type === "punctuation" && inner.value === "(") {
        depth += 1;
        continue;
      }
      if (inner.type === "punctuation" && inner.value === ")") {
        depth -= 1;
        if (depth === 0) break;
        continue;
      }
      if (depth === 1 && inner.type === "punctuation" && inner.value === ",") {
        argIndex += 1;
        continue;
      }
      if (depth === 1 && argIndex === 1 && inner.type === "string") {
        patterns.push(inner.value);
      }
    }
  }
  return patterns;
}

export function sanitizeNormalizationFormula(
  formula: string | null | undefined,
): string | null {
  const trimmed = formula?.trim() ?? "";
  if (!trimmed || trimmed.length > MAX_NORMALIZATION_FORMULA_LENGTH) {
    return null;
  }
  const patterns = regexPatternStringsFromFormula(trimmed);
  if (!patterns) return null;
  if (patterns.some((pattern) => !isSafeRegexPattern(pattern))) return null;
  return trimmed;
}

// A bad pattern yields null (an un-joinable key) rather than throwing on the
// read path — a broken formula fails visibly as "no match", never silently.
function regexExtractFormula(
  value: string,
  pattern: string,
  group: number | null,
): FormulaPrimitive {
  const regex = safeRegExp(pattern);
  if (!regex) return null;
  const match = regex.exec(value);
  if (!match) return null;
  const index = group === null ? 0 : Math.trunc(group);
  return match[index] ?? null;
}

function regexReplaceFormula(
  value: string,
  pattern: string,
  replacement: string,
): FormulaPrimitive {
  const regex = safeRegExp(pattern, "g");
  return regex ? value.replace(regex, replacement) : null;
}

export function evaluateNumericExpression(expression: string): number | null {
  const tokensOrNull = tokenizeNumericExpression(expression);
  if (!tokensOrNull) return null;
  const tokens = tokensOrNull;
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
