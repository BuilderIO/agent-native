export const CAPTURE_GRANT_PREFIX = "agentNativeCaptureGrant:";

export interface CaptureGrant {
  tabId: number;
  origin: string;
  grantedAt: number;
}

export function captureGrantKey(tabId: number): string {
  return `${CAPTURE_GRANT_PREFIX}${tabId}`;
}

export function captureOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function captureOriginPattern(value: string | undefined): string | null {
  const origin = captureOrigin(value);
  return origin ? `${origin}/*` : null;
}

export function isCaptureGrantValid(
  value: unknown,
  tabId: number,
  url: string,
): value is CaptureGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const grant = value as Partial<CaptureGrant>;
  return (
    grant.tabId === tabId &&
    grant.origin === captureOrigin(url) &&
    typeof grant.grantedAt === "number" &&
    Number.isFinite(grant.grantedAt)
  );
}

export async function hasCaptureGrant(
  tabId: number,
  url: string,
): Promise<boolean> {
  const key = captureGrantKey(tabId);
  const [stored, hasHostAccess] = await Promise.all([
    chrome.storage.session.get(key),
    hasPersistentCaptureAccess(url),
  ]);
  return isCaptureGrantValid(stored[key], tabId, url) || hasHostAccess;
}

export async function hasPersistentCaptureAccess(
  url: string,
): Promise<boolean> {
  const origin = captureOriginPattern(url);
  return origin
    ? chrome.permissions.contains({ origins: [origin] })
    : Promise.resolve(false);
}

export async function requestPersistentCaptureAccess(
  url: string,
): Promise<boolean> {
  const origin = captureOriginPattern(url);
  return origin
    ? chrome.permissions.request({ origins: [origin] })
    : Promise.resolve(false);
}
