/**
 * Extract the app ID from an OAuth state parameter without verifying the HMAC.
 * Used for routing-only purposes — security is still enforced by the app's
 * callback handler which verifies the HMAC signature.
 */
export function extractAppFromState(
  state: string | undefined,
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
