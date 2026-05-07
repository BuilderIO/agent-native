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
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
    return typeof parsed.app === "string" ? parsed.app : undefined;
  } catch {
    return undefined;
  }
}
