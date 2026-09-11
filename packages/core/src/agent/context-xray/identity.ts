export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

export function normalizeToolCallInputForIdentity(
  input: unknown,
): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { rawInput: input };
}

export function parseToolInputForIdentity(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function toolPairKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(
    normalizeToolCallInputForIdentity(parseToolInputForIdentity(input)),
  )}`;
}
