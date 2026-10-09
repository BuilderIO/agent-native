/**
 * Wire contract for coalescing same-tick action GET calls. The client POSTs
 * `{ requests }` to the batch action and gets `{ results }` back, one entry per
 * request and in the same order.
 */
export const ACTION_BATCH_ACTION_NAME = "get-actions-batch";

export const ACTION_BATCH_MAX_REQUESTS = 50;

export interface ActionBatchRequest {
  action: string;
  /** The query string a single GET of this action would carry. */
  query: string;
}

export interface ActionBatchItemResult {
  status: number;
  /** Payload of a successful item (status below 400). */
  body?: unknown;
  /** Payload of a failed item, the body its single GET would have returned. */
  error?: unknown;
  /** The response headers a single call reads: Retry-After, request id, Server-Timing. */
  headers?: Record<string, string>;
}

export interface ActionBatchResponse {
  results: ActionBatchItemResult[];
}
