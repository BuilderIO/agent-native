export function localhostConsentRequestStateAddress(designId: string) {
  const capability = `capability:visual-edit:design:${encodeURIComponent(designId)}`;
  return {
    key: `design-localhost-write-consent-request:${designId}`,
    // App-state prefixes the verified capability when it builds the session ID.
    sessionId: `capability:${capability}`,
  };
}
