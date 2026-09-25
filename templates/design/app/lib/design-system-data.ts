export interface DesignSystemData {
  source?: string;
  builderJobId?: string;
  builderProjectId?: string;
  builderBranchName?: string;
  builderUrl?: string;
  builderStatus?: string;
  /** Builder-reported indexed document count; readiness, unlike builderStatus. */
  docCount?: number;
  builderSyncedAt?: string;
  colors?: {
    primary?: unknown;
    secondary?: unknown;
    accent?: unknown;
    background?: unknown;
    surface?: unknown;
    text?: unknown;
    textMuted?: unknown;
  };
  typography?: {
    headingFont?: unknown;
    bodyFont?: unknown;
    headingWeight?: unknown;
    bodyWeight?: unknown;
  };
  spacing?: Record<string, unknown>;
  borders?: Record<string, unknown>;
  logos?: Array<{ url?: string; name?: string; variant?: string }>;
  defaults?: Record<string, unknown>;
  notes?: unknown;
  /** The source system's own named vocabulary; absent on kits predating it. */
  tokens?: unknown;
}

export function parseDesignSystemData(
  dataStr: string,
): DesignSystemData | null {
  try {
    const parsed = JSON.parse(dataStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as DesignSystemData;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * docCount is the only readiness signal: not builderStatus, not a sync
 * timestamp, not document types. A Builder-backed row with no recorded
 * docCount has not been measured yet, which is not ready.
 */
function isBuilderKitIndexed(parsed: DesignSystemData): boolean {
  return typeof parsed.docCount === "number" && parsed.docCount > 0;
}

export function shouldRefreshBuilderDesignSystem(
  system: Pick<{ accessRole?: string; data: string }, "accessRole" | "data">,
): boolean {
  const parsed = parseDesignSystemData(system.data);
  return (
    (system.accessRole === "owner" ||
      system.accessRole === "admin" ||
      system.accessRole === "editor") &&
    parsed?.source === "builder" &&
    (!isBuilderKitIndexed(parsed) || typeof parsed.builderSyncedAt !== "string")
  );
}

export function isDesignSystemUsableForGeneration(data: string): boolean {
  const parsed = parseDesignSystemData(data);
  if (!parsed) return false;
  if (parsed.source !== "builder") return true;
  return isBuilderKitIndexed(parsed);
}

export function builderRefreshKey(system: {
  id: string;
  data: string;
}): string {
  const parsed = parseDesignSystemData(system.data);
  return `${system.id}:${parsed?.builderJobId ?? "unknown"}`;
}

/**
 * Persisted `builderUrl` values are treated as a trusted navigation target
 * (rendered as an "Open in Builder" anchor). Reject anything that is not an
 * absolute https URL on builder.io before it reaches the DOM, since the
 * field is stored data that could be stale, corrupted, or tampered with by a
 * collaborator on a shared design system.
 */
export function isTrustedBuilderPreviewUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // coercion-ok: an unparseable URL is untrusted, not merely absent.
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.hostname === "builder.io" ||
      parsed.hostname.endsWith(".builder.io"))
  );
}
