/**
 * Extract the workspace app id from an agent-native OAuth state parameter
 * without verifying the HMAC signature.
 *
 * This is only for routing a provider callback to the app that will verify
 * and consume the state. The destination callback must still call
 * decodeOAuthState before trusting anything inside the payload.
 */
export function extractOAuthStateAppId(
  state: string | null | undefined,
): string | undefined {
  if (!state) return undefined;
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const data = state.slice(0, dotIdx);
    const parsed = JSON.parse(decodeBase64Url(data));
    return typeof parsed.app === "string" ? parsed.app : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: string, encoding: string): { toString(): string } };
  }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(padded, "base64").toString();
  return atob(padded);
}
