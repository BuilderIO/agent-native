import { appStatePut } from "@agent-native/core/application-state";

// Long enough for a sign-in round trip; an older request no longer reopens
// the dialog on its own.
export const LOCALHOST_CONSENT_REQUEST_TTL_MS = 30 * 60 * 1000;

export function localhostConsentRequestStateAddress(designId: string) {
  const capability = `capability:visual-edit:design:${encodeURIComponent(designId)}`;
  return {
    key: `design-localhost-write-consent-request:${designId}`,
    // App-state prefixes the verified capability when it builds the session ID.
    sessionId: `capability:${capability}`,
  };
}

export async function putLocalhostConsentRequest(
  designId: string,
  request: Record<string, unknown>,
): Promise<void> {
  const { key, sessionId } = localhostConsentRequestStateAddress(designId);
  await appStatePut(sessionId, key, request, { requestSource: "agent" });
}
