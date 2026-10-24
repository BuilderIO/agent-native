const JSON_OBJECT_BODY_REQUIRED =
  "Body cursor pagination requires a JSON object request body.";

// The one place a pagination cursor or batch is written into a request body.
// A JSON-string body keeps its other fields and is re-serialized as a string.
export function setBodyValueAtPath(
  base: unknown,
  path: string,
  value: unknown,
): unknown {
  const wasString = typeof base === "string";
  let parsed = base;
  // A blank string body is an empty body.
  if (typeof parsed === "string" && parsed.trim() === "") parsed = undefined;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error(JSON_OBJECT_BODY_REQUIRED);
    }
  }
  if (
    parsed !== undefined &&
    parsed !== null &&
    (typeof parsed !== "object" || Array.isArray(parsed))
  ) {
    throw new Error(JSON_OBJECT_BODY_REQUIRED);
  }
  const root: Record<string, unknown> = parsed
    ? { ...(parsed as Record<string, unknown>) }
    : {};
  const parts = path.split(".").filter(Boolean);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    const next =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    current[part] = next;
    current = next;
  }
  if (parts.length) current[parts[parts.length - 1]!] = value;
  return wasString ? JSON.stringify(root) : root;
}
