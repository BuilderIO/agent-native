const TRANSIENT_PROXY_RESET_PATTERN =
  /\b(?:socket hang up|read ECONNRESET|write ECONNRESET)\b/i;

export function isTransientStartupPollResponse(
  status: number,
  body: string,
): boolean {
  if (status === 503) return true;
  return status === 500 && TRANSIENT_PROXY_RESET_PATTERN.test(body);
}

export function isTransientCommittedNavigationResponse(
  status: number,
  body: string,
): boolean {
  return status === 504 || isTransientStartupPollResponse(status, body);
}

export function isPersistenceReloadFrameworkGetReset(
  status: number,
  method: string,
  pathname: string,
  body: string,
  requestWasInFlightAtReload: boolean,
): boolean {
  return (
    requestWasInFlightAtReload &&
    method === "GET" &&
    pathname.startsWith("/_agent-native/") &&
    status === 500 &&
    (body.trim() === "" || /\bECONNRESET\b/i.test(body))
  );
}

export function isRetryableSessionReadErrorMessage(message: string): boolean {
  return (
    message.includes("apiRequestContext.get: Timeout") ||
    message.includes("expected authenticated session")
  );
}
