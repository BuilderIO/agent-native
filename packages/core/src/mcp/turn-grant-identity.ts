// Keyed by the admitted identity object, so only the request that verified a
// personal device-flow token can present it.
const verifiedPersonalConnectCredentials = new WeakMap<object, string>();

export function recordTurnGrantConnectCredential(
  identity: object,
  jti: string,
): void {
  verifiedPersonalConnectCredentials.set(identity, jti);
}

export function turnGrantConnectCredential(
  identity: object,
): string | undefined {
  return verifiedPersonalConnectCredentials.get(identity);
}
