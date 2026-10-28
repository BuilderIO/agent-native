export function parseTrustedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isTrustedWebViewUrl(
  candidateUrl: string,
  trustedOrigin: string | null,
): boolean {
  if (!trustedOrigin) return false;
  try {
    return new URL(candidateUrl).origin === trustedOrigin;
  } catch {
    // coercion-ok: malformed URLs must fail closed and stay inside the WebView.
    return false;
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function isBlockedWebViewHost(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return normalized === "vector.co" || normalized.endsWith(".vector.co");
}

export function shouldOpenExternalWebViewUrl(candidateUrl: string): boolean {
  try {
    const parsed = new URL(candidateUrl);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !isBlockedWebViewHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}
