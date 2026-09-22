import {
  actionErrorMessage,
  callAction,
  readClientAppState,
  setClientAppState,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type {
  ContentTrashItem,
  ContentTrashPurgePlanResponse,
  ContentTrashPurgeStatus,
  ListContentTrashResponse,
} from "@shared/content-trash";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

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

export function trashSelectionPlanInput(
  selection: ContentTrashSelection,
): ContentTrashPurgeInput {
  return selection.mode === "matching"
    ? ({
        mode: "matching",
        filters: trashMatchingFilters(selection.filters),
      } as const)
    : ({ mode: "selection", documentIds: selection.documentIds } as const);
}

export function trashScopePlanInput(spaceId?: string): ContentTrashPurgeInput {
  return { mode: "scope" as const, ...(spaceId ? { spaceId } : {}) };
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

export function useTrashContext(args: {
  filters: ContentTrashFilters;
  selection: ContentTrashSelection;
  previewId: string | null;
  operationId?: string | null;
}) {
  useEffect(() => {
    if (args.operationId === undefined) return;
    void setClientAppState(
      "content-trash",
      {
        filters: args.filters,
        selectionMode: args.selection.mode,
        selectedIds:
          args.selection.mode === "loaded"
            ? args.selection.documentIds.slice(0, 100)
            : [],
        matchingFilters:
          args.selection.mode === "matching" ? args.selection.filters : null,
        previewId: args.previewId,
        operationId: args.operationId ?? null,
      },
      { requestSource: "content-trash" },
    );
  }, [args.filters, args.operationId, args.previewId, args.selection]);
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
  return useActionMutation<
    ContentTrashPurgePlanResponse,
    ContentTrashPurgeInput
  >("plan-content-trash-purge");
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

export function useExecuteContentTrashPurge() {
  return useActionMutation<
    { operationId: string; status: ContentTrashPurgeStatus },
    { planId: string; scopeToken: string; idempotencyKey: string }
  >("execute-content-trash-purge");
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

export async function readTrashOperationId() {
  const state = await readClientAppState<{ operationId?: unknown }>(
    "content-trash",
  );
  return typeof state?.operationId === "string" ? state.operationId : null;
}

export function isTerminalTrashOperation(status: ContentTrashPurgeStatus) {
  return status !== "queued" && status !== "running";
}

export function trashActionError(error: unknown, fallback: string) {
  return actionErrorMessage(error) ?? fallback;
}

export function trashOperationIdFromError(error: unknown) {
  const details = (error as { details?: { operationId?: unknown } } | undefined)
    ?.details;
  return typeof details?.operationId === "string" ? details.operationId : null;
}

export function useRestoreTrashItem() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { success: boolean; restored: number; documentId: string },
    { id: string }
  >("restore-document", {
    onSuccess: () => void invalidateTrashQueries(queryClient),
  });
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
