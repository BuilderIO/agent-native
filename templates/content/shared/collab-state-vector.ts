import { decodeStateVector, encodeStateVector, type Doc } from "yjs";

export type CollabStateVectorOrder =
  | "equal"
  | "ahead"
  | "behind"
  | "concurrent";

export type CollabBodySaveDecision =
  | "write"
  | "covered"
  | "sync-required"
  | "unproven";

export function encodeCollabStateVector(doc: Doc): string {
  let binary = "";
  for (const byte of encodeStateVector(doc)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeCollabStateVector(
  value: string,
): Map<number, number> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return decodeStateVector(bytes);
  } catch {
    // coercion-ok: null is the typed unreadable result; callers reject or refuse to order it.
    return null;
  }
}

export function compareCollabStateVectors(
  incoming: Map<number, number>,
  current: Map<number, number>,
): CollabStateVectorOrder {
  let incomingHasMore = false;
  let currentHasMore = false;
  for (const clientId of new Set([...incoming.keys(), ...current.keys()])) {
    const incomingClock = incoming.get(clientId) ?? 0;
    const currentClock = current.get(clientId) ?? 0;
    if (incomingClock > currentClock) incomingHasMore = true;
    if (currentClock > incomingClock) currentHasMore = true;
  }
  if (incomingHasMore && currentHasMore) return "concurrent";
  if (incomingHasMore) return "ahead";
  if (currentHasMore) return "behind";
  return "equal";
}

/**
 * Browser tabs editing one page share a Yjs document, so their body saves are
 * serializations of the same CRDT at different moments. Order them by the
 * state vector each serialization was taken from, never by a text merge: a
 * text merge cannot tell a peer's edit that arrived through Yjs from the
 * saving tab's own edit.
 *
 * A body written by anything other than a live editor (agent, API, restore,
 * sync) has no state vector. A save may replace it only when the saving
 * editor has proven that body is already inside its Yjs document; otherwise
 * the caller must use the text-merge protocol.
 */
export function decideCollabBodySave(input: {
  incomingStateVector: Map<number, number>;
  incomingIntegratedRevision?: string;
  current: {
    bodyRevision: number;
    revisionToken: string;
    stateVector: string | null;
    stateVectorRevision: number | null;
  };
}): CollabBodySaveDecision {
  const { current } = input;
  const currentVector =
    current.stateVector !== null &&
    current.stateVectorRevision === current.bodyRevision
      ? decodeCollabStateVector(current.stateVector)
      : null;
  if (currentVector) {
    const order = compareCollabStateVectors(
      input.incomingStateVector,
      currentVector,
    );
    if (order === "behind") return "covered";
    if (order === "concurrent") return "sync-required";
    return "write";
  }
  return input.incomingIntegratedRevision === current.revisionToken
    ? "write"
    : "unproven";
}
