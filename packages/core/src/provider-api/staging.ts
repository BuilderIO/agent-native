/**
 * Server-side staging layer for provider-api responses.
 *
 * ## P0 — stageAs
 * Instead of returning a raw response body to the model (which hits the 50K-char
 * context-window truncation and biases aggregates), the caller can pass
 * `stageAs: "dataset_name"` to `stagingExecuteRequest`. The runtime will:
 *   1. Execute the provider HTTP request.
 *   2. Auto-detect the items array in common response shapes.
 *   3. Write rows into `staged_datasets` + `staged_dataset_rows`.
 *   4. Return only { dataset, rowCount, columns, sampleRows: first 5 }.
 *
 * ## P1 — fetchAll
 * When `pagination` config is supplied alongside `stageAs`, the runtime
 * iterates pages server-side:
 *   - Supports nextCursor (embedded in response), offset, and page modes.
 *   - Handles 429 / Retry-After with exponential back-off.
 *   - Caps at maxPages (default 50, up to 200).
 *   - Returns { dataset, pages, rows, truncated, lastCursor } so the agent
 *     can resume with another call when capped.
 *
 * Security: re-uses executeProviderApiRequest from index.ts — SSRF-safety and
 * secret redaction are fully preserved. We read the raw (pre-redacted) JSON
 * here; redaction is applied to the response returned to the model.
 */

import type { ProviderApiRequestArgs } from "./index.js";
import {
  upsertStagedDataset,
  deriveColumns,
  MAX_ROWS_PER_APP,
} from "./staged-datasets-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Auto-detect or explicit path to the items array in a JSON response. */
export type ItemsPath =
  | "auto"
  | "data"
  | "results"
  | "items"
  | "records"
  | "rows"
  | string;

export interface PaginationConfig {
  /**
   * Dot-path in the response JSON for the next cursor/token value.
   * e.g. "next_cursor", "meta.next", "pagination.cursor"
   */
  nextCursorPath?: string;
  /**
   * Query parameter name to use for the cursor in the next request.
   * Required when nextCursorPath is set.
   */
  cursorParam?: string;
  /**
   * Use page-number mode: send `pageParam=N` for each subsequent page.
   */
  pageParam?: string;
  /** Starting page number (default 1). */
  startPage?: number;
  /**
   * Use offset mode: send `offsetParam=N` for each subsequent request.
   */
  offsetParam?: string;
  /**
   * Hint at expected page size for offset increments. Defaults to the
   * actual item count of the first page.
   */
  pageSize?: number;
  /** Maximum pages to fetch (default 50, max 200). */
  maxPages?: number;
}

export interface StageAsOptions {
  stageAs: string;
  itemsPath?: ItemsPath;
  pagination?: PaginationConfig;
}

export interface StagingRequestArgs extends ProviderApiRequestArgs {
  stageAs?: string;
  itemsPath?: ItemsPath;
  pagination?: PaginationConfig;
}

export interface StagingResult {
  dataset: {
    id: string;
    name: string;
    rowCount: number;
    columns: string[];
    sampleRows: Record<string, unknown>[];
  };
  pages?: number;
  rows?: number;
  truncated?: boolean;
  lastCursor?: string | number | null;
  provider: unknown;
  request: unknown;
  guidance: string;
}

// ---------------------------------------------------------------------------
// Resolve runtime context for scope (appId + ownerEmail)
// ---------------------------------------------------------------------------

/** Minimal callable interface accepted by stagingExecuteRequest. */
export type ProviderApiExecutor = (
  args: ProviderApiRequestArgs,
) => Promise<unknown>;

export interface StagingRuntimeContext {
  appId: string;
  ownerEmail: string;
}

// ---------------------------------------------------------------------------
// JSON path resolution helper
// ---------------------------------------------------------------------------

function getAtPath(obj: unknown, path: string): unknown {
  if (!path || obj === undefined || obj === null) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object")
      return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Auto-detect items array
// ---------------------------------------------------------------------------

export function extractItemsArray(
  body: unknown,
  itemsPath: ItemsPath = "auto",
): unknown[] {
  if (!body || typeof body !== "object") return [];

  if (Array.isArray(body)) return body as unknown[];

  if (itemsPath !== "auto") {
    const val = getAtPath(body, itemsPath);
    return Array.isArray(val) ? (val as unknown[]) : [];
  }

  // Auto-detect: common shapes
  const obj = body as Record<string, unknown>;
  for (const key of ["data", "results", "items", "records", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  // Single-key object wrapping an array
  const keys = Object.keys(obj);
  if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
    return obj[keys[0]] as unknown[];
  }

  // If the object itself looks like a flat row, wrap it
  return [];
}

function extractNextCursor(body: unknown, path: string): string | null {
  const val = getAtPath(body, path);
  if (val === null || val === undefined || val === "" || val === false)
    return null;
  return String(val);
}

// ---------------------------------------------------------------------------
// 429 / Retry-After handling
// ---------------------------------------------------------------------------

async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(
  responseHeaders: Record<string, string> | undefined,
  attempt: number,
): number {
  if (responseHeaders) {
    const raw =
      responseHeaders["retry-after"] ?? responseHeaders["Retry-After"];
    if (raw) {
      const secs = parseFloat(raw);
      if (!isNaN(secs)) return secs * 1000;
    }
  }
  // Exponential back-off: 1s, 2s, 4s, 8s, cap 30s
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

// ---------------------------------------------------------------------------
// Core staging executor
// ---------------------------------------------------------------------------

/**
 * Execute a provider API request and stage the result into scratch storage.
 * Returns a compact summary instead of the raw body.
 *
 * @param args  — request args including stageAs / itemsPath / pagination
 * @param execute — callable provider executor (e.g. `runtime.executeRequest.bind(runtime)`)
 * @param ctx   — (appId, ownerEmail) for dataset ownership scoping
 */
export async function stagingExecuteRequest(
  args: StagingRequestArgs,
  execute: ProviderApiExecutor,
  ctx: StagingRuntimeContext,
): Promise<StagingResult> {
  const datasetName = args.stageAs!;
  const itemsPath = args.itemsPath ?? "auto";
  const pagination = args.pagination;
  const maxPages = Math.min(pagination?.maxPages ?? 50, 200);

  // Strip staging fields from the underlying request args
  const baseArgs: ProviderApiRequestArgs = {
    provider: args.provider,
    method: args.method,
    path: args.path,
    query: args.query,
    headers: args.headers,
    body: args.body,
    auth: args.auth,
    timeoutMs: args.timeoutMs,
    maxBytes: args.maxBytes,
    connectionId: args.connectionId,
    accountId: args.accountId,
  };

  let allRows: Record<string, unknown>[] = [];
  let pages = 0;
  let truncated = false;
  let lastCursor: string | number | null = null;
  let providerMeta: unknown;
  let requestMeta: unknown;

  // Generate a stable dataset id for this name+owner combination so re-staging
  // the same dataset replaces it rather than accumulating duplicates.
  const datasetId = `ds_${ctx.appId}_${ctx.ownerEmail}_${datasetName}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  // -------------------------------------------------------------------------
  // Page loop
  // -------------------------------------------------------------------------
  let currentArgs = { ...baseArgs };
  let pageNum = pagination?.startPage ?? 1;
  let offset = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    // Inject pagination params for pages 2+
    if (pageIndex > 0 && pagination) {
      const extraQuery: Record<string, unknown> =
        typeof currentArgs.query === "object" && currentArgs.query !== null
          ? { ...(currentArgs.query as Record<string, unknown>) }
          : {};

      if (pagination.cursorParam && lastCursor !== null) {
        extraQuery[pagination.cursorParam] = lastCursor;
      } else if (pagination.pageParam) {
        extraQuery[pagination.pageParam] = pageNum;
      } else if (pagination.offsetParam) {
        extraQuery[pagination.offsetParam] = offset;
      } else {
        // No pagination config for next page — stop
        break;
      }
      currentArgs = { ...currentArgs, query: extraQuery };
    }

    // -----------------------------------------------------------------------
    // Execute with retry on 429
    // -----------------------------------------------------------------------
    let result: Record<string, unknown>;
    let attempt = 0;
    for (;;) {
      const raw = (await execute(currentArgs)) as Record<string, unknown>;
      const response = raw.response as Record<string, unknown> | undefined;
      if (response?.status === 429) {
        if (attempt >= 5) {
          throw new Error(
            `Provider returned 429 Too Many Requests after ${attempt + 1} attempts. ` +
              `Try again later or reduce the page count.`,
          );
        }
        const waitMs = getRetryAfterMs(
          response.headers as Record<string, string> | undefined,
          attempt,
        );
        await sleepMs(waitMs);
        attempt++;
        continue;
      }
      result = raw;
      break;
    }

    pages++;
    if (pageIndex === 0) {
      providerMeta = result.provider;
      requestMeta = result.request;
    }

    const response = result.response as Record<string, unknown> | undefined;
    if (!response?.ok) {
      // Non-200 on first page is a hard error; on subsequent pages, stop early
      if (pageIndex === 0) {
        throw new Error(
          `Provider API returned status ${response?.status}: ${JSON.stringify(response?.json ?? response?.text).slice(0, 200)}`,
        );
      }
      truncated = true;
      break;
    }

    const body =
      response.json ??
      (response.text ? tryParseJson(response.text as string) : null);
    const pageRows = extractItemsArray(body, itemsPath);

    if (pageRows.length === 0) {
      // Empty page — end of data
      break;
    }

    const typedRows = pageRows.map((r) =>
      r && typeof r === "object"
        ? (r as Record<string, unknown>)
        : { value: r },
    );
    allRows = allRows.concat(typedRows);

    // Cap check — stop before exceeding limit
    if (allRows.length >= MAX_ROWS_PER_APP) {
      truncated = true;
      allRows = allRows.slice(0, MAX_ROWS_PER_APP);
      break;
    }

    // If no pagination config or single-page mode, stop after first page
    if (!pagination || pageIndex === maxPages - 1) {
      if (pageIndex === maxPages - 1 && pagination) truncated = true;
      break;
    }

    // Derive next cursor / offset / page
    if (pagination.nextCursorPath) {
      const next = extractNextCursor(body, pagination.nextCursorPath);
      if (!next) break; // No more pages
      lastCursor = next;
    } else if (pagination.pageParam) {
      pageNum++;
    } else if (pagination.offsetParam) {
      const pageSize = pagination.pageSize ?? pageRows.length;
      offset += pageSize;
    } else {
      break;
    }
  }

  // -------------------------------------------------------------------------
  // Persist to staging store
  // -------------------------------------------------------------------------
  const columns = deriveColumns(allRows);
  const meta = await upsertStagedDataset({
    id: datasetId,
    appId: ctx.appId,
    ownerEmail: ctx.ownerEmail,
    name: datasetName,
    rows: allRows,
    columns,
  });

  return {
    dataset: {
      id: meta.id,
      name: meta.name,
      rowCount: meta.rowCount,
      columns: meta.columns,
      sampleRows: allRows.slice(0, 5),
    },
    ...(pagination
      ? {
          pages,
          rows: allRows.length,
          truncated,
          lastCursor,
        }
      : {}),
    provider: providerMeta,
    request: requestMeta,
    guidance:
      "Data staged successfully. Use query-staged-dataset to run aggregations on this dataset without re-fetching. " +
      "Staging avoids sending raw response bodies through the context window.",
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
