import { AsyncLocalStorage } from "node:async_hooks";

import type { ActionRunContext } from "@agent-native/core/action";

import type { DocumentBodyIntent } from "../../shared/document-intent-order.js";

export interface ContentBodyIntentRecord {
  /**
   * Without `authoredBaseRevision`, persist records the revision the edit
   * was applied to: the page's, under its lock.
   */
  intent: Omit<DocumentBodyIntent, "authoredBaseRevision"> & {
    authoredBaseRevision?: number;
  };
  /**
   * For a writer that knows its result only once the edit runs: without
   * these, persist takes the committed body's hash and the blocks it changed.
   */
  candidateHash?: string;
  metadataHash?: string;
  changedBlockIndexes?: number[];
  displacedCheckpointId?: string;
}

/**
 * Why a server write changed a page body. A live-copy commit's `persist`
 * records it: a History transition for every commit, and the body intent once
 * the commit's revision is known. Server writers pass it to
 * `editContentLiveCopy`, which also records an unchanged edit's intent; core
 * runs no binding persist for one. Give each edit its own cause; an intent
 * recorded twice would claim two revisions.
 */
export interface ContentBodyWriteCause {
  ctx?: ActionRunContext;
  /** The History operation, such as `"accept-suggestion"`. */
  operation: string;
  origin?: string;
  historySessionId?: string;
  intent?: ContentBodyIntentRecord;
}

/** A page being switched to its live copy, from the body at `baseRevision`. */
export interface LiveBodyConversion {
  documentId: string;
  baseRevision: number;
}

interface WriteScope {
  cause: ContentBodyWriteCause;
  conversion?: LiveBodyConversion;
}

const scopes = new AsyncLocalStorage<WriteScope>();

export function withContentBodyWriteCause<T>(
  cause: ContentBodyWriteCause,
  run: () => Promise<T>,
): Promise<T> {
  return scopes.run({ cause }, run);
}

export function currentContentBodyWriteCause():
  | ContentBodyWriteCause
  | undefined {
  return scopes.getStore()?.cause;
}

/**
 * Runs a conversion. The page is not switched until its commit lands, so the
 * binding treats `conversion.documentId` as a live copy only inside `run`.
 */
export function withLiveBodyConversion<T>(
  conversion: LiveBodyConversion,
  cause: ContentBodyWriteCause,
  run: () => Promise<T>,
): Promise<T> {
  return scopes.run({ cause, conversion }, run);
}

export function liveBodyConversionFor(
  documentId: string,
): LiveBodyConversion | undefined {
  const conversion = scopes.getStore()?.conversion;
  return conversion?.documentId === documentId ? conversion : undefined;
}
