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
  write: (
    state: DocumentPropertyState,
    expectedGeneration: number | undefined,
  ) => Promise<{ generation?: number }>;
  reportsErrors: boolean;
}

interface DocumentPropertyChangeGroup {
  entry: LocalOpUndoEntry<DocumentPropertyUndoStep>;
  keys: Set<string>;
  complete: boolean;
}

type DocumentPropertyKeyTarget = Pick<
  DocumentPropertyUndoTarget,
  "documentId" | "propertyId"
>;

const controllers = new WeakMap<
  QueryClient,
  LocalOpUndoController<DocumentPropertyUndoStep>
>();
const openGroups = new WeakMap<QueryClient, DocumentPropertyChangeGroup>();
const savedGenerations = new WeakMap<QueryClient, Map<string, number>>();
const applying = new WeakSet<QueryClient>();

export function documentPropertyUndo(queryClient: QueryClient) {
  let controller = controllers.get(queryClient);
  if (!controller) {
    controller = createLocalOpUndoController<DocumentPropertyUndoStep>({
      apply: (steps, direction, entry) =>
        applyDocumentPropertySteps(queryClient, steps, direction, entry),
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
    generation: number | undefined;
    write: DocumentPropertyUndoStep["write"];
    reportsErrors: boolean;
  },
) {
  if (applying.has(queryClient)) {
    forgetDocumentPropertyChanges(queryClient);
    return;
  }
  rememberSavedGeneration(queryClient, change.target, change.generation);
  if (sameDocumentPropertyValue(change.before.value, change.after.value)) {
    return;
  }
  const step = (state: DocumentPropertyState): DocumentPropertyUndoStep => ({
    ...change.target,
    ...state,
    write: change.write,
    reportsErrors: change.reportsErrors,
  });
  const key = documentPropertyKey(change.target);
  const group = openGroups.get(queryClient);
  if (group?.keys.has(key)) {
    group.entry.undo.push(step(change.before));
    group.entry.redo.push(step(change.after));
    return;
  }
  documentPropertyUndo(queryClient).push({
    undo: [step(change.before)],
    redo: [step(change.after)],
    coalesceKey: key,
  });
}

export async function groupDocumentPropertyChanges<T>(
  queryClient: QueryClient,
  targets: DocumentPropertyKeyTarget[],
  run: () => Promise<T>,
): Promise<T> {
  const group: DocumentPropertyChangeGroup = {
    entry: { undo: [], redo: [] },
    keys: new Set(targets.map(documentPropertyKey)),
    complete: true,
  };
  openGroups.set(queryClient, group);
  try {
    return await run();
  } finally {
    openGroups.delete(queryClient);
    if (group.complete && group.entry.redo.length > 0) {
      documentPropertyUndo(queryClient).push(group.entry);
    }
  }
}

export function forgetDocumentPropertyChanges(queryClient: QueryClient) {
  const group = openGroups.get(queryClient);
  if (group) group.complete = false;
  documentPropertyUndo(queryClient).clear();
}

function documentPropertyKey(target: DocumentPropertyKeyTarget) {
  return `${target.documentId}:${target.propertyId}`;
}

function rememberSavedGeneration(
  queryClient: QueryClient,
  target: DocumentPropertyUndoTarget,
  generation: number | undefined,
) {
  let generations = savedGenerations.get(queryClient);
  if (!generations) {
    generations = new Map();
    savedGenerations.set(queryClient, generations);
  }
  if (generation === undefined) generations.delete(documentPropertyKey(target));
  else generations.set(documentPropertyKey(target), generation);
}

export function withExpectedGeneration<T extends object>(
  request: T,
  expectedGeneration: number | undefined,
): T & { expectedGeneration?: number } {
  return expectedGeneration === undefined
    ? request
    : { ...request, expectedGeneration };
}

export function isPropertyGenerationConflict(error: unknown) {
  return (
    (error as { errorCode?: unknown } | null)?.errorCode ===
    "PROPERTY_GENERATION_CONFLICT"
  );
}

async function applyDocumentPropertySteps(
  queryClient: QueryClient,
  steps: DocumentPropertyUndoStep[],
  direction: "undo" | "redo",
  entry: LocalOpUndoEntry<DocumentPropertyUndoStep>,
): Promise<boolean | "conflict"> {
  const expected = direction === "undo" ? entry.redo : entry.undo;
  const showChangedSince = () =>
    toast(
      dbText(
        direction === "undo"
          ? "undoPropertyChangedSince"
          : "redoPropertyChangedSince",
      ),
    );
  const saveStep = async (step: DocumentPropertyUndoStep) => {
    const saved = await step.write(
      documentPropertyState(step.value, step.relationTargets),
      savedGenerations.get(queryClient)?.get(documentPropertyKey(step)),
    );
    rememberSavedGeneration(queryClient, step, saved.generation);
  };
  const written: DocumentPropertyUndoStep[] = [];
  let writing: DocumentPropertyUndoStep | undefined;
  applying.add(queryClient);
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
    const changed = steps.some((step, index) => {
      const current = currents[index];
      return (
        !current ||
        (!sameDocumentPropertyValue(current.value, step.value) &&
          !sameDocumentPropertyValue(current.value, expected[index]?.value))
      );
    });
    if (changed) {
      showChangedSince();
      return "conflict";
    }
    for (const [index, step] of steps.entries()) {
      if (sameDocumentPropertyValue(currents[index]?.value, step.value)) {
        continue;
      }
      writing = step;
      await saveStep(step);
      writing = undefined;
      const restore = expected[index];
      if (restore) written.push(restore);
    }
    return true;
  } catch (error) {
    if (isPropertyGenerationConflict(error)) {
      for (const restore of written.reverse()) {
        const putBack = await saveStep(restore).then(
          () => true,
          () => false,
        );
        if (!putBack) break;
      }
      showChangedSince();
      return "conflict";
    }
    if (!writing?.reportsErrors) {
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
  } finally {
    applying.delete(queryClient);
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
    forgetDocumentPropertyChanges(queryClient);
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
