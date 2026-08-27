export interface DesignSystemData {
  source?: string;
  builderJobId?: string;
  builderProjectId?: string;
  builderBranchName?: string;
  builderUrl?: string;
  builderStatus?: string;
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

export function shouldRefreshBuilderDesignSystem(
  system: Pick<{ accessRole?: string; data: string }, "accessRole" | "data">,
): boolean {
  const parsed = parseDesignSystemData(system.data);
  return (
    (system.accessRole === "owner" ||
      system.accessRole === "admin" ||
      system.accessRole === "editor") &&
    parsed?.source === "builder" &&
    (parsed.builderStatus === "in-progress" ||
      ((parsed.builderStatus === "ready" ||
        parsed.builderStatus === "complete" ||
        parsed.builderStatus === "completed") &&
        typeof parsed.builderSyncedAt !== "string"))
  );
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
