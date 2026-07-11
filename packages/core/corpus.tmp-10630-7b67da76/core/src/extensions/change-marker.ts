export const EXTENSION_CHANGE_MARKER_KEY = "__extensions_change__";
export const EXTENSION_CHANGE_MARKER_ORG_PREFIX = "__org__:";

export interface ExtensionChangeTarget {
  owner?: string;
  orgId?: string;
}

export function extensionChangeMarkerSession(
  target: ExtensionChangeTarget,
): string | null {
  if (target.owner) return target.owner;
  if (target.orgId)
    return `${EXTENSION_CHANGE_MARKER_ORG_PREFIX}${target.orgId}`;
  return null;
}

export function extensionChangeMarkerValue(
  target: ExtensionChangeTarget,
): Record<string, string> {
  return {
    source: "extensions",
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
  };
}

export function parseExtensionChangeMarker(
  sessionId: unknown,
  value: unknown,
): ExtensionChangeTarget | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const owner = typeof record.owner === "string" ? record.owner : undefined;
    const orgId = typeof record.orgId === "string" ? record.orgId : undefined;
    if (owner || orgId) return { owner, orgId };
  }

  if (typeof sessionId !== "string" || !sessionId) return null;
  if (sessionId.startsWith(EXTENSION_CHANGE_MARKER_ORG_PREFIX)) {
    const orgId = sessionId.slice(EXTENSION_CHANGE_MARKER_ORG_PREFIX.length);
    return orgId ? { orgId } : null;
  }
  return { owner: sessionId };
}
