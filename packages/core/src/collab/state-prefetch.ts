import { agentNativePath } from "../client/api-path.js";
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

const prefetches = new Map<string, Promise<CollabStateRequest>>();

/**
 * Starts reading a doc's collab state at page boot, beside the page's other
 * first reads, instead of after the editor mounts. It reads this browser's
 * saved copy of the doc first, when there is one, and asks only for what the
 * copy lacks. The editor's connection takes the answer over when it opens the
 * same doc within a few seconds, and only for the account the copy belongs
 * to; an answer nobody takes is dropped.
 */
export function prefetchCollabState(
  docId: string,
  options: { baseUrl?: string } = {},
): void {
  if (typeof window === "undefined" || !docId) return;
  const baseUrl = options.baseUrl ?? agentNativePath("/_agent-native/collab");
  const key = collabLocalCopyKey(baseUrl, docId);
  if (prefetches.has(key)) return;
  const prefetch = (async (): Promise<CollabStateRequest> => {
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
    const request = requestCollabState(baseUrl, docId, stateVector);
    return {
      account: localState ? account : null,
      localState,
      ...request,
    };
  })();
  prefetches.set(key, prefetch);
  setTimeout(() => {
    if (prefetches.get(key) === prefetch) prefetches.delete(key);
  }, PREFETCH_TTL_MS);
}

/** Takes the prefetched request for a doc, at most once. */
export function takeCollabStatePrefetch(
  baseUrl: string,
  docId: string,
): Promise<CollabStateRequest> | undefined {
  const key = collabLocalCopyKey(baseUrl, docId);
  const prefetch = prefetches.get(key);
  if (prefetch) prefetches.delete(key);
  return prefetch;
}

/** Drops every prefetched answer, as signing out does. */
export function dropCollabStatePrefetches(): void {
  prefetches.clear();
}
