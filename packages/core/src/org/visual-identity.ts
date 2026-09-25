import {
  iconValueSchema,
  parseIconValue,
  serializeIconValue,
  type IconValue,
} from "../icons/index.js";

/** Decode persisted organization icon JSON without turning corruption into a reset. */
export function parseOrganizationIconJson(value: unknown): IconValue | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Organization icon storage is unreadable.");
  }
  try {
    return parseIconValue(JSON.parse(value));
  } catch {
    throw new Error("Organization icon storage is unreadable.");
  }
}

/** Validate the public mutation boundary until the shared schema is decoded. */
export function requireOrganizationIconValue(value: unknown): IconValue {
  return iconValueSchema.parse(value);
}

export function serializeOrganizationIcon(
  icon: IconValue | null,
): string | null {
  return serializeIconValue(icon);
}
