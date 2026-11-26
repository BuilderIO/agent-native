import {
  actionErrorMessage,
  callAction,
  readClientAppState,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import type {
  ContentTrashFilterOptionsResponse,
  ContentTrashItem,
  ContentTrashPurgePlanResponse,
  ContentTrashPurgeSpace,
  ContentTrashPurgeStatus,
  ContentTrashWhere,
  ListContentTrashPurgeSpacesResponse,
  ListContentTrashResponse,
} from "@shared/content-trash";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useContentActionMutation } from "./use-content-action-mutation";
import { restoredDocumentTargets } from "./use-documents";

export interface ContentTrashFilters {
  query?: string;
  kind?: "page" | "database";
  spaceId?: string;
  parentId?: string;
  actor?: string;
  createdBy?: string;
  updatedBy?: string;
  deletedFrom?: string;
  deletedTo?: string;
  where?: ContentTrashWhere;
  sort?: ContentTrashSort;
  direction?: ContentTrashSortDirection;
}

export type ContentTrashSort = "name" | "createdAt" | "updatedAt" | "deletedAt";
export type ContentTrashSortDirection = "asc" | "desc";

export function changeTrashSort(
  filters: ContentTrashFilters,
  sort: ContentTrashSort,
): ContentTrashFilters {
  return {
    ...filters,
    sort,
    direction:
      filters.sort === sort
        ? filters.direction === "asc"
          ? "desc"
          : "asc"
        : sort === "name"
          ? "asc"
          : "desc",
  };
}

export function trashMatchingFilters(filters: ContentTrashFilters) {
  const { sort: _sort, direction: _direction, ...matching } = filters;
  return matching;
}

export function trashFilterMembershipKey(filters: ContentTrashFilters) {
  return JSON.stringify(trashMatchingFilters(filters));
}

export function reconcileTrashBrowseFilters(
  previous: ContentTrashFilters,
  next: ContentTrashFilters,
  expandedIds: string[],
) {
  const membershipChanged =
    trashFilterMembershipKey(previous) !== trashFilterMembershipKey(next);
  const sortChanged =
    (previous.sort ?? "deletedAt") !== (next.sort ?? "deletedAt") ||
    (previous.direction ?? "desc") !== (next.direction ?? "desc");
  return {
    expandedIds: membershipChanged ? [] : expandedIds,
    clearNestedItems: membershipChanged || sortChanged,
  };
}

export type ContentTrashSelection =
  | { mode: "loaded"; documentIds: string[] }
  | { mode: "matching"; filters: ContentTrashFilters };

export type ContentTrashPurgeInput =
  | { mode: "scope"; spaceId?: string }
  | { mode: "selection"; documentIds: string[] }
  | { mode: "matching"; filters: ContentTrashFilters };

export function loadedTrashSelection(
  documentIds: string[],
): ContentTrashSelection {
  return { mode: "loaded", documentIds: [...new Set(documentIds)] };
}

export function clearTrashSelection(): ContentTrashSelection {
  return loadedTrashSelection([]);
}

export function trashSelectionCount(selection: ContentTrashSelection) {
  return selection.mode === "loaded" ? selection.documentIds.length : null;
}

export interface ContentTrashPurgeTarget {
  spaceId: string | null;
  input: ContentTrashPurgeInput;
}

export interface ContentTrashPurgeRequest {
  kind: "empty" | "delete";
  targets: ContentTrashPurgeTarget[];
  unavailableSpaceIds: string[];
}

function splitPurgeSpaces(
  spaces: readonly ContentTrashPurgeSpace[],
  spaceIds: readonly string[],
) {
  const unavailable = new Set(
    spaces.filter((space) => !space.canPurge).map((space) => space.spaceId),
  );
  return {
    purgeable: spaceIds.filter((spaceId) => !unavailable.has(spaceId)),
    unavailable: spaceIds.filter((spaceId) => unavailable.has(spaceId)),
  };
}

export function trashEmptyRequest(
  spaces: readonly ContentTrashPurgeSpace[],
): ContentTrashPurgeRequest {
  const { purgeable, unavailable } = splitPurgeSpaces(
    spaces,
    spaces.map((space) => space.spaceId),
  );
  return {
    kind: "empty",
    targets: purgeable.map((spaceId) => ({
      spaceId,
      input: { mode: "scope", spaceId },
    })),
    unavailableSpaceIds: unavailable,
  };
}

export function trashDeleteRequest(
  selection: ContentTrashSelection,
  loadedItems: ContentTrashItem[],
  spaces: readonly ContentTrashPurgeSpace[],
): ContentTrashPurgeRequest {
  if (selection.mode === "matching") {
    const filters = trashMatchingFilters(selection.filters);
    const { purgeable, unavailable } = splitPurgeSpaces(
      spaces,
      filters.spaceId
        ? [filters.spaceId]
        : spaces.map((space) => space.spaceId),
    );
    return {
      kind: "delete",
      targets: purgeable.map((spaceId) => ({
        spaceId,
        input: { mode: "matching", filters: { ...filters, spaceId } },
      })),
      unavailableSpaceIds: unavailable,
    };
  }
  const spaceByDocument = new Map(
    loadedItems.map((item) => [item.documentId, item.spaceId]),
  );
  const documentsBySpace = new Map<string | null, string[]>();
  for (const documentId of selection.documentIds) {
    const spaceId = spaceByDocument.get(documentId) ?? null;
    documentsBySpace.set(spaceId, [
      ...(documentsBySpace.get(spaceId) ?? []),
      documentId,
    ]);
  }
  const unavailable = new Set(
    splitPurgeSpaces(
      spaces,
      [...documentsBySpace.keys()].filter(
        (spaceId): spaceId is string => spaceId !== null,
      ),
    ).unavailable,
  );
  return {
    kind: "delete",
    targets: [...documentsBySpace]
      .filter(([spaceId]) => spaceId === null || !unavailable.has(spaceId))
      .map(([spaceId, documentIds]) => ({
        spaceId,
        input: { mode: "selection", documentIds },
      })),
    unavailableSpaceIds: [...unavailable],
  };
}

export function useContentTrashPurgeSpaces() {
  return useQuery({
    queryKey: ["action", "list-content-trash-purge-spaces"],
    queryFn: ({ signal }) =>
      callAction<ListContentTrashPurgeSpacesResponse>(
        "list-content-trash-purge-spaces",
        {},
        { method: "GET", signal },
      ),
    retry: false,
  });
}

export function useContentTrashFilterOptions() {
  return useQuery({
    queryKey: ["action", "list-content-trash-filter-options"],
    queryFn: ({ signal }) =>
      callAction<ContentTrashFilterOptionsResponse>(
        "list-content-trash-filter-options",
        {},
        { method: "GET", signal },
      ),
    retry: false,
  });
}

export function contentTrashQueryKey(
  filters: ContentTrashFilters,
  groupId?: string,
) {
  return ["action", "list-content-trash", { ...filters, groupId }] as const;
}

export function useContentTrash(
  filters: ContentTrashFilters,
  groupId?: string,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: contentTrashQueryKey(filters, groupId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      callAction<ListContentTrashResponse>(
        "list-content-trash",
        {
          ...filters,
          ...(groupId ? { groupId } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { method: "GET", signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
    retry: false,
  });
}

export interface ContentTrashPurgeStart {
  spaceId: string | null;
  planId: string | null;
  idempotencyKey: string | null;
  status: "starting" | "started" | "failed" | "unknown";
  operationId: string | null;
  error: string | null;
}

export interface TrashContextState {
  filters: ContentTrashFilters;
  selection: ContentTrashSelection;
  previewId: string | null;
  purgeStarts: ContentTrashPurgeStart[];
}

export function writeTrashContext(state: TrashContextState) {
  const operationIds = trashPurgeOperationIds(state.purgeStarts);
  return setClientAppState(
    "content-trash",
    {
      filters: state.filters,
      selectionMode: state.selection.mode,
      selectedIds:
        state.selection.mode === "loaded"
          ? state.selection.documentIds.slice(0, 100)
          : [],
      matchingFilters:
        state.selection.mode === "matching" ? state.selection.filters : null,
      previewId: state.previewId,
      operationId: operationIds[0] ?? null,
      operationIds,
      purgeStarts: state.purgeStarts,
    },
    { requestSource: "content-trash" },
  );
}

export function useTrashContext(
  state: Omit<TrashContextState, "purgeStarts"> & {
    purgeStarts: ContentTrashPurgeStart[] | undefined;
  },
) {
  const { filters, selection, previewId, purgeStarts } = state;
  useEffect(() => {
    if (purgeStarts === undefined) return;
    void writeTrashContext({ filters, selection, previewId, purgeStarts });
  }, [filters, purgeStarts, previewId, selection]);
}

function trashPurgeStartKey(start: ContentTrashPurgeStart) {
  return start.planId ?? `operation:${start.operationId}`;
}

export function upsertTrashPurgeStarts(
  current: readonly ContentTrashPurgeStart[],
  updates: readonly ContentTrashPurgeStart[],
) {
  const next = [...current];
  for (const update of updates) {
    const index = next.findIndex(
      (start) => trashPurgeStartKey(start) === trashPurgeStartKey(update),
    );
    if (index < 0) next.push(update);
    else next[index] = update;
  }
  return next;
}

export function trashPurgeOperationIds(
  starts: readonly ContentTrashPurgeStart[],
) {
  return starts.flatMap((start) =>
    start.status === "started" && start.operationId ? [start.operationId] : [],
  );
}

export function trashPurgeStartAfterError<T extends ContentTrashPurgeStart>(
  start: T,
  error: unknown,
  fallback: string,
): T {
  const operationId = trashOperationIdFromError(error);
  if (operationId)
    return { ...start, status: "started", operationId, error: null };
  const status = (error as { status?: unknown } | undefined)?.status;
  return {
    ...start,
    status:
      typeof status === "number" && status >= 400 && status < 500
        ? "failed"
        : "unknown",
    error: trashActionError(error, fallback),
  };
}

const PURGE_START_STATUSES = new Set<ContentTrashPurgeStart["status"]>([
  "starting",
  "started",
  "failed",
  "unknown",
]);

function parseTrashPurgeStart(value: unknown): ContentTrashPurgeStart {
  if (typeof value !== "object" || value === null)
    throw new Error("Saved Trash purge state is malformed");
  const start = value as Partial<Record<keyof ContentTrashPurgeStart, unknown>>;
  const text = (field: unknown) =>
    typeof field === "string" ? field : field === null ? null : undefined;
  const parsed = {
    spaceId: text(start.spaceId),
    planId: text(start.planId),
    idempotencyKey: text(start.idempotencyKey),
    status: start.status,
    operationId: text(start.operationId),
    error: text(start.error),
  };
  if (
    Object.values(parsed).some((field) => field === undefined) ||
    !PURGE_START_STATUSES.has(parsed.status as ContentTrashPurgeStart["status"])
  )
    throw new Error("Saved Trash purge state is malformed");
  const known = parsed as ContentTrashPurgeStart;
  return known.status === "starting" ? { ...known, status: "unknown" } : known;
}

export async function readTrashPurgeStarts(): Promise<
  ContentTrashPurgeStart[]
> {
  const state = await readClientAppState<{
    operationId?: unknown;
    operationIds?: unknown;
    purgeStarts?: unknown;
  }>("content-trash");
  if (Array.isArray(state?.purgeStarts))
    return state.purgeStarts.map(parseTrashPurgeStart);
  const operationIds =
    Array.isArray(state?.operationIds) && state.operationIds.length
      ? state.operationIds.filter((id): id is string => typeof id === "string")
      : typeof state?.operationId === "string"
        ? [state.operationId]
        : [];
  return operationIds.map((operationId) => ({
    spaceId: null,
    planId: null,
    idempotencyKey: null,
    status: "started",
    operationId,
    error: null,
  }));
}

export interface ContentTrashOperation {
  operationId: string;
  planId: string;
  idempotencyKey: string;
  status: ContentTrashPurgeStatus;
  eligibleCount: number;
  deletedCount: number;
  blockedCount: number;
  conflictedCount: number;
  remains: number;
  outcomes: Array<{
    documentId: string;
    title: string;
    outcome: string;
    detail: string | null;
  }>;
  nextCursor: string | null;
  lastError: string | null;
  completedAt: string | null;
}

export function usePlanContentTrashPurge() {
  return useContentActionMutation<
    ContentTrashPurgePlanResponse,
    ContentTrashPurgeInput
  >("plan-content-trash-purge", { invalidates: [] });
}

export interface ContentTrashPlanDetails {
  planId: string;
  state: string;
  eligibleCount: number;
  blockedCount: number;
  items: Array<{
    documentId: string;
    title: string;
    eligible: boolean;
    blocker: string | null;
    survivorEffect: string | null;
  }>;
  nextCursor: string | null;
}

export function useContentTrashPurgePlan(planId: string | null) {
  return useInfiniteQuery({
    queryKey: ["action", "get-content-trash-purge-plan", { planId }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!planId) throw new Error("planId is required");
      return callAction<ContentTrashPlanDetails>(
        "get-content-trash-purge-plan",
        { planId, ...(pageParam ? { cursor: pageParam } : {}) },
        { method: "GET", signal },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(planId),
    retry: false,
  });
}

// The purge runs as an operation; useContentTrashOperation refreshes Trash when it ends.
export function useExecuteContentTrashPurge() {
  return useContentActionMutation<
    { operationId: string; status: ContentTrashPurgeStatus },
    { planId: string; scopeToken: string; idempotencyKey: string }
  >("execute-content-trash-purge", {
    invalidates: [["action", "list-content-trash"]],
  });
}

export function useContentTrashOperation(operationId: string | null) {
  const queryClient = useQueryClient();
  const invalidatedOperation = useRef<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["action", "get-content-trash-operation", { operationId }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      if (!operationId) throw new Error("operationId is required");
      return callAction<ContentTrashOperation>(
        "get-content-trash-operation",
        { operationId, ...(pageParam ? { cursor: pageParam } : {}) },
        { method: "GET", signal },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(operationId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.status === "queued" ||
      query.state.data?.pages[0]?.status === "running"
        ? 1_500
        : false,
  });

  useEffect(() => {
    const progress = query.data?.pages[0];
    if (!progress || !isTerminalTrashOperation(progress.status)) return;
    if (invalidatedOperation.current === progress.operationId) return;
    invalidatedOperation.current = progress.operationId;
    void invalidateTrashQueries(queryClient);
  }, [query.data, queryClient]);

  return query;
}

export function isTerminalTrashOperation(status: ContentTrashPurgeStatus) {
  return status !== "queued" && status !== "running";
}

export function trashActionError(error: unknown, fallback: string) {
  return actionErrorMessage(error) ?? fallback;
}

/** The server already retried; its English message is written for agents. */
export function isRestoreBusyError(error: unknown) {
  return (
    (error as { errorCode?: unknown } | undefined)?.errorCode ===
    "DATABASE_MEMBERSHIPS_CHANGED"
  );
}

export function isTrashRevisionConflict(error: unknown) {
  return (
    (error as { errorCode?: unknown } | undefined)?.errorCode ===
    "TRASH_REVISION_CONFLICT"
  );
}

export function trashOperationIdFromError(error: unknown) {
  const details = (error as { details?: { operationId?: unknown } } | undefined)
    ?.details;
  return typeof details?.operationId === "string" ? details.operationId : null;
}

export interface RestoreTrashPageResult {
  success: boolean;
  documentId: string;
  affectedDocumentIds: string[];
  affectedDocumentIdsComplete: boolean;
  receipt: { outcome: "restored" | "unchanged" };
}

export function useRestoreTrashPage() {
  return useContentActionMutation<
    RestoreTrashPageResult,
    { id: string; expectedTrashedAt: string; idempotencyKey: string }
  >("restore-document", {
    invalidates: (_data, { id }) => restoredDocumentTargets(id),
  });
}

export function trashRestoreCollectionId(item: ContentTrashItem) {
  return item.legacyRestoreDatabaseId ?? item.databaseId;
}

export function restoredTrashItemIds(
  item: Pick<ContentTrashItem, "documentId" | "trashedAt">,
  loadedItems: readonly ContentTrashItem[],
  receipt: Pick<
    RestoreTrashPageResult,
    "affectedDocumentIds" | "affectedDocumentIdsComplete"
  > | null,
) {
  const ids = new Set([
    item.documentId,
    ...(receipt?.affectedDocumentIds ?? []),
  ]);
  if (!receipt?.affectedDocumentIdsComplete)
    for (const loaded of loadedItems)
      if (
        loaded.trashRootId === item.documentId &&
        loaded.trashedAt === item.trashedAt
      )
        ids.add(loaded.documentId);
  return ids;
}

export function trashRestoreTargets(selectedItems: ContentTrashItem[]) {
  const selectedIds = new Set(selectedItems.map((item) => item.documentId));
  return selectedItems.filter(
    (item) =>
      item.canRestore &&
      !(
        item.trashRootId &&
        item.trashRootId !== item.documentId &&
        selectedIds.has(item.trashRootId)
      ),
  );
}

export async function invalidateTrashQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["action", "list-content-trash"],
    }),
    queryClient.invalidateQueries({ queryKey: ["action", "list-documents"] }),
    queryClient.invalidateQueries({
      queryKey: ["action", "get-content-database"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["action", "list-trashed-documents"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["action", "list-trashed-content-databases"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["action", "list-content-trash-filter-options"],
    }),
  ]);
}

export function uniqueTrashItems(items: ContentTrashItem[]) {
  return [...new Map(items.map((item) => [item.documentId, item])).values()];
}

export function selectedTrashItems(
  visibleItems: ContentTrashItem[],
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  return uniqueTrashItems(visibleItems).filter((item) =>
    selected.has(item.documentId),
  );
}

export function visibleTrashItems(
  topLevelItems: ContentTrashItem[],
  nestedItems: Record<string, ContentTrashItem[]>,
  expandedIds: string[],
) {
  const expanded = new Set(expandedIds);
  return uniqueTrashItems(
    topLevelItems.flatMap((item) => [
      item,
      ...(expanded.has(item.documentId)
        ? (nestedItems[item.documentId] ?? [])
        : []),
    ]),
  );
}

export function trashSelectionState(
  visibleIds: string[],
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  const count = visibleIds.filter((id) => selected.has(id)).length;
  return count === 0
    ? false
    : count === visibleIds.length
      ? true
      : "indeterminate";
}

export function toggleVisibleTrashSelection(
  visibleIds: string[],
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  for (const id of visibleIds)
    allSelected ? selected.delete(id) : selected.add(id);
  return [...selected];
}

export function extendTrashSelection(
  visibleIds: string[],
  selectedIds: string[],
  anchorId: string,
  targetId: string,
) {
  const anchor = visibleIds.indexOf(anchorId);
  const target = visibleIds.indexOf(targetId);
  if (anchor < 0 || target < 0) return selectedIds;
  const selected = new Set(selectedIds);
  for (const id of visibleIds.slice(
    Math.min(anchor, target),
    Math.max(anchor, target) + 1,
  ))
    selected.add(id);
  return [...selected];
}

export function nearestVisibleTrashRow(
  previousOrder: string[],
  nextOrder: string[],
  focusedId: string | null,
) {
  if (!nextOrder.length) return null;
  if (focusedId && nextOrder.includes(focusedId)) return focusedId;
  const previousIndex = focusedId ? previousOrder.indexOf(focusedId) : -1;
  return (
    nextOrder[Math.min(Math.max(previousIndex, 0), nextOrder.length - 1)] ??
    null
  );
}
