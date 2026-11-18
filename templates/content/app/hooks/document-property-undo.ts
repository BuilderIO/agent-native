import {
  createLocalOpUndoController,
  type LocalOpUndoController,
  type LocalOpUndoEntry,
} from "@agent-native/core/client/collab";
import { callActionWithRetry } from "@agent-native/core/client/hooks";
import type {
  ContentDatabaseItemsPageResponse,
  ContentDatabaseResponse,
  DocumentPropertiesResponse,
  DocumentProperty,
  DocumentPropertyRelationTarget,
  DocumentPropertyValue,
} from "@shared/api";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";

import { dbText } from "../components/editor/database/text";
import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseQueryFilter,
} from "./use-content-database";
import { documentPropertiesQueryKey } from "./use-documents";

export interface DocumentPropertyUndoTarget {
  documentId: string;
  databaseId: string;
  databaseDocumentId: string;
  propertyId: string;
}

export interface DocumentPropertyState {
  value: DocumentPropertyValue;
  relationTargets?: DocumentPropertyRelationTarget[];
}

export interface DocumentPropertyUndoStep
  extends DocumentPropertyUndoTarget, DocumentPropertyState {
  write: (state: DocumentPropertyState) => Promise<unknown>;
  reportsErrors: boolean;
}

const controllers = new WeakMap<
  QueryClient,
  LocalOpUndoController<DocumentPropertyUndoStep>
>();
const openGroups = new WeakMap<
  QueryClient,
  LocalOpUndoEntry<DocumentPropertyUndoStep>
>();

export function documentPropertyUndo(queryClient: QueryClient) {
  let controller = controllers.get(queryClient);
  if (!controller) {
    controller = createLocalOpUndoController<DocumentPropertyUndoStep>({
      apply: applyDocumentPropertySteps,
    });
    controllers.set(queryClient, controller);
  }
  return controller;
}

export function cachedDocumentPropertyState(
  queryClient: QueryClient,
  target: DocumentPropertyUndoTarget,
): DocumentPropertyState | null {
  const reads: Array<{ at: number; property: DocumentProperty }> = [];
  const cache = queryClient.getQueryCache();
  const page = cache.find<DocumentPropertiesResponse>({
    queryKey: documentPropertiesQueryKey(target.documentId, target.databaseId),
    exact: true,
  });
  const fromPage = page?.state.data?.properties.find(
    (property) => property.definition.id === target.propertyId,
  );
  if (page && fromPage) {
    reads.push({ at: page.state.dataUpdatedAt, property: fromPage });
  }
  const views = [
    ...cache.findAll(contentDatabaseQueryFilter(target.databaseDocumentId)),
    ...cache.findAll(
      contentDatabaseConstrainedQueryFilter(target.databaseDocumentId),
    ),
  ];
  for (const query of views) {
    const data = query.state.data as
      | ContentDatabaseResponse
      | ContentDatabaseItemsPageResponse
      | undefined;
    const item = Array.isArray(data?.items)
      ? data.items.find((row) => row.document.id === target.documentId)
      : undefined;
    if (!item) continue;
    const own = item.properties.find(
      (candidate) => candidate.definition.id === target.propertyId,
    );
    const unset =
      !own && data && "properties" in data
        ? data.properties.find(
            (candidate) => candidate.definition.id === target.propertyId,
          )
        : undefined;
    const property = own ?? (unset && { ...unset, value: null });
    if (property) reads.push({ at: query.state.dataUpdatedAt, property });
  }
  if (reads.length === 0) return null;
  if (reads.some((read) => read.property.definition.type === "blocks")) {
    return null;
  }
  const freshest = reads.reduce((best, read) =>
    read.at > best.at ? read : best,
  );
  return documentPropertyState(
    freshest.property.value,
    freshest.property.relationTargets,
  );
}

export function recordDocumentPropertyChange(
  queryClient: QueryClient,
  change: {
    target: DocumentPropertyUndoTarget;
    before: DocumentPropertyState;
    after: DocumentPropertyState;
    write: DocumentPropertyUndoStep["write"];
    reportsErrors: boolean;
  },
) {
  if (sameDocumentPropertyValue(change.before.value, change.after.value)) {
    return;
  }
  const step = (state: DocumentPropertyState): DocumentPropertyUndoStep => ({
    ...change.target,
    ...state,
    write: change.write,
    reportsErrors: change.reportsErrors,
  });
  const group = openGroups.get(queryClient);
  if (group) {
    group.undo.push(step(change.before));
    group.redo.push(step(change.after));
    return;
  }
  documentPropertyUndo(queryClient).push({
    undo: [step(change.before)],
    redo: [step(change.after)],
    coalesceKey: `${change.target.documentId}:${change.target.propertyId}`,
  });
}

export async function groupDocumentPropertyChanges<T>(
  queryClient: QueryClient,
  run: () => Promise<T>,
): Promise<T> {
  const group: LocalOpUndoEntry<DocumentPropertyUndoStep> = {
    undo: [],
    redo: [],
  };
  openGroups.set(queryClient, group);
  try {
    return await run();
  } finally {
    openGroups.delete(queryClient);
    if (group.redo.length > 0) documentPropertyUndo(queryClient).push(group);
  }
}

async function applyDocumentPropertySteps(
  steps: DocumentPropertyUndoStep[],
  direction: "undo" | "redo",
  entry: LocalOpUndoEntry<DocumentPropertyUndoStep>,
): Promise<boolean | "conflict"> {
  const expected = direction === "undo" ? entry.redo : entry.undo;
  try {
    const currents = await Promise.all(
      steps.map(async (step) => {
        const read = await callActionWithRetry<DocumentPropertiesResponse>(
          "list-document-properties",
          { documentId: step.documentId, databaseId: step.databaseId },
        );
        return read.properties.find(
          (candidate) => candidate.definition.id === step.propertyId,
        );
      }),
    );
    const pending = steps.filter(
      (step, index) =>
        !sameDocumentPropertyValue(currents[index]?.value, step.value),
    );
    const changed = steps.some((step, index) => {
      const current = currents[index];
      return (
        !current ||
        (!sameDocumentPropertyValue(current.value, step.value) &&
          !sameDocumentPropertyValue(current.value, expected[index]?.value))
      );
    });
    if (changed) {
      toast(
        dbText(
          direction === "undo"
            ? "undoPropertyChangedSince"
            : "redoPropertyChangedSince",
        ),
      );
      return "conflict";
    }
    for (const step of pending) {
      await step.write(documentPropertyState(step.value, step.relationTargets));
    }
    return true;
  } catch (error) {
    if (!steps.some((step) => step.reportsErrors)) {
      toast.error(
        dbText(
          direction === "undo" ? "undoPropertyFailed" : "redoPropertyFailed",
        ),
        {
          description:
            error instanceof Error
              ? error.message
              : dbText("somethingWentWrong"),
        },
      );
    }
    return false;
  }
}

export function sameDocumentPropertyValue(
  a: DocumentPropertyValue | undefined,
  b: DocumentPropertyValue | undefined,
) {
  return stableJson(a ?? null) === stableJson(b ?? null);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function documentPropertyState(
  value: DocumentPropertyValue,
  relationTargets: DocumentPropertyRelationTarget[] | undefined,
): DocumentPropertyState {
  return relationTargets ? { value, relationTargets } : { value };
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

export function documentPropertyUndoKey(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target"
  >,
): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (isTextEntryTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

export function useDocumentPropertyUndoShortcuts() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();

  useEffect(() => {
    documentPropertyUndo(queryClient).clear();
  }, [queryClient, pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const direction = documentPropertyUndoKey(event);
      if (!direction) return;
      const controller = documentPropertyUndo(queryClient);
      if (
        direction === "undo" ? !controller.canUndo() : !controller.canRedo()
      ) {
        return;
      }
      event.preventDefault();
      void (direction === "undo" ? controller.undo() : controller.redo());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [queryClient]);
}
