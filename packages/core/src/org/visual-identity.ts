import {
  iconValueSchema,
  parseIconValue,
  serializeIconValue,
  type IconValue,
} from "../icons/index.js";

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

export function requireOrganizationIconValue(value: unknown): IconValue {
  return iconValueSchema.parse(value);
}

export function serializeOrganizationIcon(
  icon: IconValue | null,
): string | null {
  return serializeIconValue(icon);
}
