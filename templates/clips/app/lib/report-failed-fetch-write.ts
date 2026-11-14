import {
  reportWriteFailure,
  writeFailureFromResponse,
} from "@agent-native/core/client/write-failure";

/**
 * Announce a raw `fetch` write that did not land, either a rejected request or
 * a non-ok response. Pass the in-flight request; a caller that does not await
 * it leaves no unhandled rejection behind.
 */
export function reportFailedFetchWrite(request: Promise<Response>): void {
  request.then(
    (res) => {
      if (res.ok) return;
      reportWriteFailure(writeFailureFromResponse(res));
    },
    (error: unknown) => reportWriteFailure(error),
  );
}
