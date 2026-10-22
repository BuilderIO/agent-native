import { setResponseHeader } from "h3";

/**
 * The turn this request's run is stored under, for the client to report. The
 * id can come from the request body, and a header value outside visible ASCII
 * throws once the run has started, so such an id is left to the client's own.
 */
export function setRunTurnIdHeader(
  event: Parameters<typeof setResponseHeader>[0],
  turnId: string,
): void {
  if (/^[\x20-\x7e]+$/.test(turnId)) {
    setResponseHeader(event, "X-Turn-Id", turnId);
  }
}
