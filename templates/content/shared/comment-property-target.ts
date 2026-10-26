import type { DocumentProperty } from "./api.js";
import { formulaValueText, isDocumentPropertyDateValue } from "./properties.js";

/** The longest Property value a Comment remembers, in characters. */
export const COMMENT_PROPERTY_VALUE_MAX_LENGTH = 200;

/**
 * Property types whose value depends on who reads it: a relation shows only
 * the rows its reader can open, a rollup adds up only those rows, and a
 * formula can read either. A Comment records no value for these, so one
 * reader's view never reaches another; each reader sees their own.
 */
const READER_DEPENDENT_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  "relation",
  "rollup",
  "formula",
]);

/**
 * What a Property Comment targets: one Property on one Page, with the name
 * and value it had when the Comment was written.
 */
export interface CommentPropertyTarget {
  propertyId: string;
  propertyName: string;
  /** Null for relation, rollup, and formula Properties. */
  propertyValue: string | null;
}

function optionNames(property: DocumentProperty, ids: string[]) {
  return ids.map(
    (id) =>
      property.definition.options.options?.find((option) => option.id === id)
        ?.name ?? id,
  );
}

function fileName(value: string) {
  const path = value.split(/[?#]/)[0] ?? value;
  const name = path.split("/").filter(Boolean).pop() ?? value;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function plainBlocksText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The value a reader sees for a Property, as plain text. Select options show
 * their names, relations show the linked rows this viewer can see, and dates
 * show their range. An empty value is an empty string.
 */
export function commentPropertyValueText(property: DocumentProperty): string {
  const { type } = property.definition;
  const value = property.value;
  if (value === null || value === undefined || value === "") return "";
  let text: string;
  if (type === "select" || type === "status") {
    text = optionNames(property, [
      typeof value === "string" ? value : formulaValueText(value),
    ]).join("");
  } else if (type === "multi_select" && Array.isArray(value)) {
    text = optionNames(property, value).join(", ");
  } else if (type === "relation" && Array.isArray(value)) {
    const titles = new Map(
      (property.relationTargets ?? []).map((target) => [
        target.documentId,
        target.title || "Untitled",
      ]),
    );
    text = value.flatMap((id) => titles.get(id) ?? []).join(", ");
  } else if (type === "files_media" && Array.isArray(value)) {
    text = value.map(fileName).join(", ");
  } else if (type === "checkbox") {
    text = value ? "Checked" : "Unchecked";
  } else if (type === "blocks" && typeof value === "string") {
    text = plainBlocksText(value);
  } else if (type === "date" && isDocumentPropertyDateValue(value)) {
    text = formulaValueText(value);
  } else {
    text = formulaValueText(value);
  }
  text = text.trim();
  return text.length > COMMENT_PROPERTY_VALUE_MAX_LENGTH
    ? `${text.slice(0, COMMENT_PROPERTY_VALUE_MAX_LENGTH - 1).trimEnd()}…`
    : text;
}

export function commentPropertyTarget(
  property: DocumentProperty,
): CommentPropertyTarget {
  return {
    propertyId: property.definition.id,
    propertyName: property.definition.name,
    propertyValue: READER_DEPENDENT_PROPERTY_TYPES.has(property.definition.type)
      ? null
      : commentPropertyValueText(property),
  };
}
