export interface DesignSystemData {
  source?: string;
  builderJobId?: string;
  builderProjectId?: string;
  builderBranchName?: string;
  builderUrl?: string;
  builderStatus?: string;
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
