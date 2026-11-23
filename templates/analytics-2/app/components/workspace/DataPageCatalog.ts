import { useEffect, useRef } from "react";

import type { DatasetLoader, DatasetPage } from "@/components/data/model";
import type { DataBrowserCatalog } from "@/lib/model/data-catalog-contracts";

/**
 * A saved-catalog read carries the whole matching count and a snapshot
 * revision. The success marker is required by the published contract; the
 * defensive fallback below keeps an older runtime from presenting a failed
 * first cache as a successful empty one.
 */
export type CatalogOutput = DataBrowserCatalog;

export type CatalogViewState = "ready" | "last-good" | "blocked" | "stale";

export function readCatalogRevision(output: CatalogOutput): string | null {
  const revision: unknown = output.revision;
  return typeof revision === "string" && revision.length > 0 ? revision : null;
}

export function catalogHasSuccessfulSnapshot(output: CatalogOutput): boolean {
  const marker: unknown = output.hasSuccessfulSnapshot;
  if (typeof marker === "boolean") {
    return marker;
  }
  // Conservative legacy fallback: only a completed ready snapshot counts. A
  // failed/stale state with an old timestamp must not become a successful
  // empty cache.
  return output.refreshState === "ready" && output.lastRefreshed !== null;
}

/**
 * The server-published opaque bootstrap key identifies org + connection +
 * source. It is the only safe identity for the shared bootstrap controller; a
 * missing key means the adapter must not auto-bootstrap.
 */
export function catalogBootstrapKey(output: CatalogOutput): string | undefined {
  const value: unknown = (output as { bootstrapKey?: unknown }).bootstrapKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Legacy predicate kept for the pre-key model expectations. */
export function shouldBootstrapCatalog(
  output: CatalogOutput,
  canManageMetadata: boolean,
): boolean {
  return (
    canManageMetadata &&
    output.refreshState === "never" &&
    !catalogHasSuccessfulSnapshot(output)
  );
}

/** Product policy: never + manager + a published bootstrap key. */
export function shouldBootstrapCatalogWithKey(
  output: CatalogOutput,
  canManageMetadata: boolean,
  bootstrapKey: string | undefined,
): boolean {
  return (
    bootstrapKey !== undefined &&
    shouldBootstrapCatalog(output, canManageMetadata)
  );
}

export function catalogViewState(output: CatalogOutput): CatalogViewState {
  if (!catalogHasSuccessfulSnapshot(output))
    return output.refreshState === "stale" ? "stale" : "blocked";
  return output.refreshState === "ready" ? "ready" : "last-good";
}

/**
 * A stable reset token for the mounted root readers. The server revision is
 * authoritative when present; otherwise the refresh state and last successful
 * timestamp still change only when a replacement is confirmed.
 */
export function catalogRevision(output: CatalogOutput): string {
  return (
    readCatalogRevision(output) ??
    `${output.connectionId}:${output.refreshState}:${output.lastRefreshed ?? "none"}`
  );
}

/**
 * Both mounted root readers use this same token. It changes only when the saved
 * snapshot or the explicit local restart changes, never for a same-source
 * refresh failure that keeps last-good rows.
 */
export function rootReaderRevision(
  output: CatalogOutput,
  readerRevision: number,
): string {
  return `${catalogRevision(output)}:${catalogViewState(output) === "stale" ? "stale" : "live"}:${readerRevision}`;
}

/**
 * The first root page can carry a newer revision than the controller's
 * `first:1` query. Only a same-connection mismatch is actionable; a page from
 * another connection must never sync/reset the selected one.
 */
export function catalogRevisionKey(
  output: CatalogOutput,
  controllerOutput: CatalogOutput,
): string | undefined {
  if (output.connectionId !== controllerOutput.connectionId) return undefined;
  const pageRevision = catalogRevision(output);
  const controllerRevision = catalogRevision(controllerOutput);
  if (pageRevision === controllerRevision) return undefined;
  return `${output.connectionId}:${pageRevision}:${controllerRevision}`;
}

export const CATALOG_LEASE_WATCH_INTERVAL_MS = 5_000;
export const CATALOG_LEASE_WATCH_CEILING_MS = 10 * 60_000 + 5_000;

/**
 * Bounded read-only GET watch for a remote refresh lease. It never starts a
 * refresh mutation, stops on a selected/key change or unmount, and has an
 * explicit ceiling. The caller disables it on a query error (including auth
 * denial) via `enabled`.
 */
export function useCatalogLeaseWatch({
  data,
  enabled,
  refetch,
  watchKey,
}: {
  data: CatalogOutput | undefined;
  enabled: boolean;
  refetch: () => Promise<unknown>;
  watchKey: string | undefined;
}) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (
      !enabled ||
      !watchKey ||
      data?.refreshState !== "refreshing" ||
      data.refreshStale
    ) {
      return;
    }
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (Date.now() - startedAt >= CATALOG_LEASE_WATCH_CEILING_MS) return;
        await settleRefetch(refetchRef.current);
        if (!cancelled) schedule();
      }, CATALOG_LEASE_WATCH_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    data?.refreshState,
    data?.refreshStale,
    data?.refreshProgress?.pages,
    data?.refreshProgress?.collectedCount,
    enabled,
    watchKey,
  ]);
}

export interface RevisionSyncState {
  key: string;
  count: number;
}

/**
 * One coordinated refetch/reset per observed mismatch key. Re-observing the
 * same page/controller pair must not loop the reset.
 */
export function nextRevisionSync(
  state: RevisionSyncState,
  key: string,
): { sync: boolean; state: RevisionSyncState } {
  const count = state.key === key ? state.count + 1 : 1;
  return { sync: count === 1, state: { key, count } };
}

/**
 * One per-selected-source reset budget shared by both root readers. A map of
 * keys alone still allows alternating keys; the total limits bound the actual
 * restart/sync work. Identity changes (connection/source) and deliberate
 * refreshes reset it; another reader's matching answer does not.
 */
export class RootResetBudget {
  private identity = "";
  private readonly staleKeys = new Set<string>();
  private readonly revisionKeys = new Set<string>();

  constructor(
    private readonly staleLimit = 2,
    private readonly revisionLimit = 2,
  ) {}

  setIdentity(identity: string): void {
    if (identity === this.identity) return;
    this.identity = identity;
    this.staleKeys.clear();
    this.revisionKeys.clear();
  }

  allowStale(key: string): boolean {
    if (this.staleKeys.has(key)) return false;
    if (this.staleKeys.size >= this.staleLimit) return false;
    this.staleKeys.add(key);
    return true;
  }

  allowRevision(key: string): boolean {
    if (this.revisionKeys.has(key)) return false;
    if (this.revisionKeys.size >= this.revisionLimit) return false;
    this.revisionKeys.add(key);
    return true;
  }

  reset(): void {
    this.staleKeys.clear();
    this.revisionKeys.clear();
  }

  get staleExhausted(): boolean {
    return this.staleKeys.size >= this.staleLimit;
  }

  get revisionExhausted(): boolean {
    return this.revisionKeys.size >= this.revisionLimit;
  }
}

export class CatalogRevisionSyncError extends Error {
  constructor() {
    super("The saved data catalog changed while loading. Try again.");
    this.name = "CatalogRevisionSyncError";
  }
}

export function shouldCoordinateCatalogResult({
  requestConnectionId,
  selectedConnectionId,
  signalAborted,
}: {
  requestConnectionId: string;
  selectedConnectionId: string | undefined;
  signalAborted: boolean;
}): boolean {
  return !signalAborted && requestConnectionId === selectedConnectionId;
}

export interface CatalogRootGateInput {
  hasOutput: boolean;
  state: CatalogViewState | "loading" | "error";
  initializing: boolean;
  bootstrapGateOpen: boolean;
  refreshPending: boolean;
  remoteRefreshing: boolean;
  fetching: boolean;
  queryError: boolean;
}

/**
 * Blocked/unavailable roots stay in the existing loading state while an
 * initialization, refresh, remote refresh or catalog refetch is in progress.
 * Only settled blocked/error states enable the readers to surface the inline
 * error. Ready/last-good rows stay readable regardless of a background refresh.
 */
export function catalogRootEnabled(input: CatalogRootGateInput): boolean {
  if (!input.hasOutput) return input.queryError;
  if (input.state !== "blocked") return true;
  return !(
    input.initializing ||
    input.bootstrapGateOpen ||
    input.refreshPending ||
    input.remoteRefreshing ||
    input.fetching
  );
}

/** A refresh completion must not surface an unhandled refetch rejection. */
export async function settleRefetch(
  refetch: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await refetch();
    return true;
  } catch {
    return false;
  }
}

/** Count-based pending state so A's refresh never marks B pending. */
export function withConnectionRefreshPending(
  pending: ReadonlyMap<string, number>,
  connectionId: string,
  delta: 1 | -1,
): ReadonlyMap<string, number> {
  const next = new Map(pending);
  const count = (next.get(connectionId) ?? 0) + delta;
  if (count <= 0) next.delete(connectionId);
  else next.set(connectionId, count);
  return next;
}

export function connectionRefreshPending(
  pending: ReadonlyMap<string, number>,
  connectionId: string | undefined,
): boolean {
  return connectionId !== undefined && (pending.get(connectionId) ?? 0) > 0;
}

export function catalogPageFromOutput(output: CatalogOutput): DatasetPage {
  return {
    items: output.resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      ...(resource.hasChildren === undefined
        ? {}
        : { hasChildren: resource.hasChildren }),
    })),
    endCursor: output.endCursor,
    hasNextPage: output.hasNextPage,
    totalCount: output.totalCount,
  };
}

export class CatalogUnavailableError extends Error {
  constructor(readonly state: "blocked" | "stale") {
    super(
      state === "stale"
        ? "The saved data catalog is out of date. Refresh it before browsing."
        : "No saved data catalog is available for this connection yet.",
    );
    this.name = "CatalogUnavailableError";
  }
}

export type CatalogRootRequest = Pick<
  Parameters<DatasetLoader>[0],
  "connectionId" | "first" | "after" | "search" | "signal"
>;

export interface DatasetLoadDependencies {
  catalog: (input: CatalogRootRequest) => Promise<CatalogOutput>;
  provider: (input: Parameters<DatasetLoader>[0]) => Promise<DatasetPage>;
}

/**
 * Root reads come only from the saved catalog. Provider reads are only for a
 * non-empty parent. A catalog failure is never retried against the provider.
 */
export async function loadDatasetPage(
  input: Parameters<DatasetLoader>[0],
  dependencies: DatasetLoadDependencies,
): Promise<DatasetPage> {
  if (input.parentId !== undefined) return dependencies.provider(input);
  const output = await dependencies.catalog({
    connectionId: input.connectionId,
    first: input.first,
    ...(input.after === undefined ? {} : { after: input.after }),
    ...(input.search === undefined ? {} : { search: input.search }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const state = catalogViewState(output);
  if (state === "blocked" || state === "stale") {
    throw new CatalogUnavailableError(state);
  }
  return catalogPageFromOutput(output);
}

const CATALOG_CURSOR_STALE_CODE = "data_catalog_cursor_stale";

/**
 * Product restart predicate: only the known stale-cursor code may enter the
 * bounded restart path. Other 409/business/deletion conflicts must surface.
 */
export function isKnownCatalogCursorRestart(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = record.errorCode ?? record.code;
  return code === CATALOG_CURSOR_STALE_CODE;
}

/** Legacy broad predicate kept for the existing helper expectations. */
export function isStaleCatalogCursorError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (status === 409) return true;
  const code = record.code ?? record.errorCode;
  return (
    typeof code === "string" && /(?:stale|cursor|snapshot|revision)/i.test(code)
  );
}

export interface StaleCursorRestartState {
  key: string;
  count: number;
}

/**
 * A 409 snapshot/cursor mismatch restarts the whole root, but repeated churn
 * for the same search must stop and surface the error.
 */
export function nextStaleCursorRestart(
  state: StaleCursorRestartState,
  key: string,
  limit = 2,
): { restart: boolean; state: StaleCursorRestartState } {
  const count = state.key === key ? state.count + 1 : 1;
  return {
    restart: count <= limit,
    state: { key, count },
  };
}

/**
 * A stale-cursor result may only restart the roots when the request belongs to
 * the currently selected connection. A late A response must not touch B.
 */
export function staleCursorRestartForSelected(
  selectedConnectionId: string | undefined,
  requestConnectionId: string,
  state: StaleCursorRestartState,
  key: string,
  limit = 2,
): { restart: boolean; state: StaleCursorRestartState } | undefined {
  if (selectedConnectionId !== requestConnectionId) return undefined;
  return nextStaleCursorRestart(state, key, limit);
}

/**
 * Coalesces the single automatic missing-cache bootstrap per published
 * bootstrap key. A failed or stale catalog is never retried automatically; an
 * explicit action is the only way to retry.
 */
export class CatalogBootstrapController {
  private readonly attempted = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  ensure(
    key: string,
    eligible: boolean,
    run: () => Promise<void>,
  ): Promise<void> | undefined {
    if (!eligible) return undefined;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    if (this.attempted.has(key)) return undefined;
    this.attempted.add(key);
    const promise = run().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  isRunning(key: string): boolean {
    return this.inFlight.has(key);
  }

  hasAttempted(key: string): boolean {
    return this.attempted.has(key);
  }

  /** Test/recovery helper: forget both attempted and in-flight keys. */
  reset(): void {
    this.attempted.clear();
    this.inFlight.clear();
  }
}

/**
 * Module-scoped so the attempted/in-flight record survives a route remount.
 * The key itself is the server-published bootstrap identity, never a guessed
 * org/source value.
 */
const sharedCatalogBootstrapController = new CatalogBootstrapController();

export function getSharedCatalogBootstrapController(): CatalogBootstrapController {
  return sharedCatalogBootstrapController;
}
