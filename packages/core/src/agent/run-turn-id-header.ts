import { setResponseHeader } from "h3";

/**
 * The turn this request's run is stored under, for the client to report. The
 * id can come from the request body, and a header value outside visible ASCII
 * throws once the run has started, so such an id is left to the client's own.
 * With no id (a replayed run held by another process) no header is set, and
 * the client reports the replay's turn as unknown rather than guessing it.
 */
export function setRunTurnIdHeader(
  event: Parameters<typeof setResponseHeader>[0],
  turnId: string | undefined,
): void {
  if (turnId && /^[\x20-\x7e]+$/.test(turnId)) {
    setResponseHeader(event, "X-Turn-Id", turnId);
  }
}
