import { agentNativePath } from "../client/api-path.js";
import {
  currentSessionIdentity,
  subscribeSessionIdentity,
  subscribeSessionInvalidation,
} from "../client/session-identity.js";
import {
  collabLocalCopyAccount,
  collabLocalCopyKey,
  readCollabLocalCopy,
} from "./local-store.js";

/**
 * A request for a doc's collab state, built on this browser's saved copy of
 * the doc when there is one.
 */
export interface CollabStateRequest {
  /** The account whose saved copy the request was built on, or null without one. */
  account: string | null;
  /** That saved copy, or null when the request asks for the whole state. */
  localState: Uint8Array | null;
  /** Whether the request sent a state vector, so the answer is a diff. */
  withStateVector: boolean;
  response: Promise<Response>;
}

/**
 * Longer than a state vector the URL should carry. A doc edited in many
 * sessions has one entry per session, so its vector can outgrow what proxies
 * accept in a URL; such a doc asks for the whole state instead.
 */
const MAX_URL_STATE_VECTOR_CHARS = 2048;

/** An answer nobody takes within this long is dropped. */
const PREFETCH_TTL_MS = 15_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Asks for what a client at `stateVector` lacks, or the whole state without one. */
export function requestCollabState(
  baseUrl: string,
  docId: string,
  stateVector: Uint8Array | null,
): { response: Promise<Response>; withStateVector: boolean } {
  const encoded = stateVector ? toBase64(stateVector) : null;
  const vector =
    encoded !== null && encoded.length <= MAX_URL_STATE_VECTOR_CHARS
      ? encoded
      : null;
  const url =
    vector !== null
      ? `${baseUrl}/${docId}/state?stateVector=${encodeURIComponent(vector)}`
      : `${baseUrl}/${docId}/state`;
  return {
    response: fetch(url, {
      cache: "no-store",
      headers: { "X-Agent-Native-Poll-Baseline": "1" },
    }),
    withStateVector: vector !== null,
  };
}

/**
 * A boot read, and the session it was made under. Requests carry the tab's
 * cookie, so the answer is that session's: until this tab first reads its
 * session, the first identity it reads; then that identity for good.
 */
interface CollabStatePrefetch {
  request: Promise<CollabStateRequest>;
  identity: string | null | undefined;
  dropped: boolean;
}

/** A boot read the editor took, with whether its session is still the tab's. */
export interface TakenCollabStatePrefetch {
  request: Promise<CollabStateRequest>;
  /** False once this tab's session is another, or another tab's changed. */
  isCurrent(): boolean;
}

const prefetches = new Map<string, CollabStatePrefetch>();
// Reads not yet answered or expired, taken or not: an account change drops them all.
const unexpired = new Set<CollabStatePrefetch>();
let sessionWatchInstalled = false;

function dropPrefetch(prefetch: CollabStatePrefetch): void {
  prefetch.dropped = true;
  unexpired.delete(prefetch);
  for (const [key, value] of prefetches) {
    if (value === prefetch) prefetches.delete(key);
  }
}

// One account's answer must never open a doc for another: any change of the
// tab's session drops what was read under the one before, and so does a
// sign-out or organization switch, in this tab or another, which can change
// the cookie before this tab reads its session again.
function watchSession(): void {
  if (sessionWatchInstalled) return;
  sessionWatchInstalled = true;
  subscribeSessionIdentity((identity) => {
    for (const prefetch of [...unexpired]) {
      if (prefetch.identity === undefined && typeof identity === "string") {
        prefetch.identity = identity;
      } else if (prefetch.identity !== identity) {
        dropPrefetch(prefetch);
      }
    }
  });
  subscribeSessionInvalidation(dropCollabStatePrefetches);
}

/**
 * Starts reading a doc's collab state at page boot, beside the page's other
 * first reads, instead of after the editor mounts. It reads this browser's
 * saved copy of the doc first, when there is one, and asks only for what the
 * copy lacks. The editor's connection takes the answer over when it opens the
 * same doc within a few seconds, and only while this tab's session is still
 * the one the read was made under; an answer nobody takes is dropped.
 */
export function prefetchCollabState(
  docId: string,
  options: { baseUrl?: string } = {},
): void {
  if (typeof window === "undefined" || !docId) return;
  const identity = currentSessionIdentity();
  // Signed out, the read could only be refused.
  if (identity === null) return;
  const baseUrl = options.baseUrl ?? agentNativePath("/_agent-native/collab");
  const key = collabLocalCopyKey(baseUrl, docId);
  if (prefetches.has(key)) return;
  watchSession();
  const request = (async (): Promise<CollabStateRequest> => {
    const account = await collabLocalCopyAccount();
    const read = account
      ? await readCollabLocalCopy(account, key)
      : ({ status: "miss" } as const);
    let localState = read.status === "hit" ? read.state : null;
    let stateVector: Uint8Array | null = null;
    if (localState) {
      try {
        // Loaded only with a copy, so a page's first boot doesn't wait on it.
        const { encodeStateVectorFromUpdate } = await import("yjs");
        stateVector = encodeStateVectorFromUpdate(localState);
      } catch {
        // coercion-ok: the request goes without the copy, and the connection,
        // which only takes a request built on a copy, reads the copy itself.
        localState = null;
      }
    }
    const sent = requestCollabState(baseUrl, docId, stateVector);
    return {
      account: localState ? account : null,
      localState,
      ...sent,
    };
  })();
  const prefetch: CollabStatePrefetch = { request, identity, dropped: false };
  prefetches.set(key, prefetch);
  unexpired.add(prefetch);
  setTimeout(() => {
    unexpired.delete(prefetch);
    if (prefetches.get(key) === prefetch) prefetches.delete(key);
  }, PREFETCH_TTL_MS);
}

/**
 * Takes the boot read for a doc, at most once, while this tab's session is
 * the one it was made under.
 */
export function takeCollabStatePrefetch(
  baseUrl: string,
  docId: string,
): TakenCollabStatePrefetch | undefined {
  const key = collabLocalCopyKey(baseUrl, docId);
  const prefetch = prefetches.get(key);
  if (!prefetch) return undefined;
  prefetches.delete(key);
  const isCurrent = () =>
    !prefetch.dropped &&
    typeof prefetch.identity === "string" &&
    prefetch.identity === currentSessionIdentity();
  if (!isCurrent()) {
    dropPrefetch(prefetch);
    return undefined;
  }
  return { request: prefetch.request, isCurrent };
}

/** Drops every boot read, as signing out does. */
export function dropCollabStatePrefetches(): void {
  for (const prefetch of [...unexpired]) dropPrefetch(prefetch);
  for (const prefetch of prefetches.values()) prefetch.dropped = true;
  prefetches.clear();
}
