const BINARY_OR_TRANSCRIPT_FIELD =
  /(?:attachment|audio|base64|binary|file|image|media|recording|transcript|video)/i;

function hasBase64Shape(value: string): boolean {
  return (
    value.length > 256 &&
    /^[A-Za-z0-9+/=\s]+$/.test(value) &&
    value.replace(/\s/g, "").length % 4 === 0
  );
}

export function isSafeCrmMutationFieldName(value: string): boolean {
  return !BINARY_OR_TRANSCRIPT_FIELD.test(value);
}

export function isBoundedCrmValue(value: unknown, depth = 0): boolean {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return true;
  }
  if (typeof value === "string") {
    return (
      value.length <= 2_000 &&
      !value.trimStart().startsWith("data:") &&
      !hasBase64Shape(value)
    );
  }
  if (depth >= 4) return false;
  if (Array.isArray(value)) {
    return (
      value.length <= 40 &&
      value.every((item) => isBoundedCrmValue(item, depth + 1))
    );
  }
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 40 &&
    entries.every(
      ([key, item]) =>
        key.length <= 120 &&
        isSafeCrmMutationFieldName(key) &&
        isBoundedCrmValue(item, depth + 1),
    )
  );
}

export function isSafeCrmMutationFields(
  fields: Record<string, unknown>,
): boolean {
  return Object.entries(fields).every(
    ([name, value]) =>
      isSafeCrmMutationFieldName(name) && isBoundedCrmValue(value),
  );
}
