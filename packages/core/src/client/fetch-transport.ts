/**
 * Status reads share answers per transport: the credentials a request goes
 * out with. A `fetch` wrapper describes its own transport with
 * `markFetchTransport`: the fetch it sends the request on to unchanged, or
 * a value that stands for the credentials it adds instead, such as one
 * bearer token. An unmarked wrapper is a transport of its own.
 */
import { FETCH_TRANSPORT_CHANGED_EVENT } from "../shared/embed-auth.js";

export { FETCH_TRANSPORT_CHANGED_EVENT };

const TRANSPORT = Symbol.for("agent-native.fetch.transport");

export type FetchTransport = typeof fetch | object;

type MarkedFetch = typeof fetch & { [TRANSPORT]?: () => FetchTransport };

const MAX_WRAPPER_DEPTH = 16;
// Only the token requests carry now: a rotated-out token is not kept, and
// one that comes back is a new transport.
let currentBearer: { token: string; transport: object } | undefined;

export function markFetchTransport(
  wrapper: typeof fetch,
  transport: () => FetchTransport,
): void {
  (wrapper as MarkedFetch)[TRANSPORT] = transport;
}

/** A wrapper that sends every request on unchanged, like session replay's. */
export function markPassThroughFetch(
  wrapper: typeof fetch,
  wrapped: typeof fetch,
): void {
  markFetchTransport(wrapper, () => wrapped);
}

/** The transport of requests that carry this bearer token. */
export function bearerTransport(token: string): object {
  if (currentBearer?.token !== token) currentBearer = { token, transport: {} };
  return currentBearer.transport;
}

export function _bearerTokensHeldForTests(): string[] {
  return currentBearer ? [currentBearer.token] : [];
}

/** The transport a request sent with this fetch goes out on now. */
export function fetchTransport(fetcher: typeof fetch): FetchTransport {
  let current: FetchTransport = fetcher;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (typeof current !== "function") break;
    const transport = (current as MarkedFetch)[TRANSPORT];
    if (typeof transport !== "function") break;
    current = transport();
  }
  return current;
}

/** Tells the session that requests now go out with other credentials. */
export function announceFetchTransportChange(): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }
  window.dispatchEvent(new Event(FETCH_TRANSPORT_CHANGED_EVENT));
}
