import type { FormField, FormFileValue } from "../../shared/types.js";

export const DEFAULT_FORM_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FORM_FILE_COUNT = 5;
export const MAX_FORM_FILE_NAME_LENGTH = 255;
export const MAX_FORM_FILE_REFERENCE_URL_LENGTH = 4096;
export const MAX_FORM_FILE_REFERENCE_FIELD_LENGTH = 512;

const ACCEPT_MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const ACCEPT_WILDCARD_PATTERN = /^[a-z0-9!#$&^_.+-]+\/\*$/i;
const ACCEPT_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9.+-]*$/i;

function acceptTokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidFileAccept(value: unknown): value is string {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 500) return false;
  return acceptTokens(value).every(
    (token) =>
      token === "*/*" ||
      ACCEPT_MIME_PATTERN.test(token) ||
      ACCEPT_WILDCARD_PATTERN.test(token) ||
      ACCEPT_EXTENSION_PATTERN.test(token),
  );
}

export function formFileMaxBytes(
  field: Pick<FormField, "maxSizeBytes">,
): number {
  return Number.isSafeInteger(field.maxSizeBytes) &&
    field.maxSizeBytes! > 0 &&
    field.maxSizeBytes! <= DEFAULT_FORM_FILE_MAX_BYTES
    ? field.maxSizeBytes!
    : DEFAULT_FORM_FILE_MAX_BYTES;
}

export function formFileMaxCount(
  field: Pick<FormField, "multiple" | "maxFiles">,
): number {
  if (field.multiple !== true) return 1;
  return Number.isSafeInteger(field.maxFiles) &&
    field.maxFiles! > 0 &&
    field.maxFiles! <= MAX_FORM_FILE_COUNT
    ? field.maxFiles!
    : MAX_FORM_FILE_COUNT;
}

export function acceptsFormFileType(
  field: Pick<FormField, "accept">,
  mimeType: string,
  filename: string,
): boolean {
  const tokens = acceptTokens(field.accept);
  if (tokens.length === 0) return true;

  const mime = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  const name = filename.trim().toLowerCase();
  return tokens.some((token) => {
    if (token === "*/*" || token === mime) return true;
    if (token.endsWith("/*")) {
      return mime.startsWith(`${token.slice(0, -1)}`);
    }
    return token.startsWith(".") && name.endsWith(token);
  });
}

export function isSafeFormFileUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > MAX_FORM_FILE_REFERENCE_URL_LENGTH) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
  );
}

export function isFormFileValue(value: unknown): value is FormFileValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.url === "string" &&
    typeof file.name === "string" &&
    typeof file.type === "string" &&
    Number.isSafeInteger(file.size)
  );
}

export function sanitizeFormFileValue(value: FormFileValue): FormFileValue {
  return {
    url: value.url,
    name: value.name,
    type: value.type,
    size: value.size,
    ...(value.id ? { id: value.id } : {}),
    ...(value.provider ? { provider: value.provider } : {}),
    ...(value.handle ? { handle: value.handle } : {}),
  };
}
