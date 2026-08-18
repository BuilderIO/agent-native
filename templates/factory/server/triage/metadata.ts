export type TriageMetadata = Record<string, unknown>;

export function parseTriageMetadata(value: string): TriageMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Factory item metadata is unreadable.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Factory item metadata must be an object.");
  }
  return parsed as TriageMetadata;
}

export function serializeTriageMetadata(value: TriageMetadata): string {
  return JSON.stringify(value);
}

export function mergeTriageMetadata(
  existingJson: string,
  incoming: TriageMetadata,
): string {
  return serializeTriageMetadata({
    ...parseTriageMetadata(existingJson),
    ...incoming,
  });
}

export function metadataString(
  metadata: TriageMetadata,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

export function metadataBoolean(
  metadata: TriageMetadata,
  key: string,
): boolean | undefined {
  const value = metadata[key];
  return typeof value === "boolean" ? value : undefined;
}
