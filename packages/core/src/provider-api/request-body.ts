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
  // `ids[0]` and `ids.0` are the same path.
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  const isIndex = (part: string | undefined) =>
    part !== undefined && /^\d+$/.test(part);
  let current = root;
  parts.slice(0, -1).forEach((part, index) => {
    const existing = current[part];
    const indexNext = isIndex(parts[index + 1]);
    const next: Record<string, unknown> =
      Array.isArray(existing) && indexNext
        ? ([...existing] as unknown as Record<string, unknown>)
        : existing && typeof existing === "object" && !Array.isArray(existing)
          ? { ...(existing as Record<string, unknown>) }
          : indexNext
            ? ([] as unknown as Record<string, unknown>)
            : {};
    current[part] = next;
    current = next;
  });
  if (parts.length) current[parts[parts.length - 1]!] = value;
  return wasString ? JSON.stringify(root) : root;
}
