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
    return false;
  }
}
