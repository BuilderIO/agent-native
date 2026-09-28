import {
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
  type CodeLayerNode,
  type CodeLayerSourceEdit,
} from "@shared/code-layer";
import { normalizeScreenHtml } from "@shared/screen-annotation";

import { recordDesignPerformance } from "@/components/design/design-trace";
import {
  canonicalElementInfoForCodeLayerNode,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";

import type {
  ContentHistoryChange,
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
  FileDeletionHistorySnapshot,
  GeometryHistoryEntry,
  GeometryHistorySelection,
  YjsUndoSelectionSnapshot,
} from "./history";
import { mapSourceNodeIds } from "./source-publication";

export type HistorySources = Record<string, string>;
type SourceFile = Pick<
  FileDeletionHistorySnapshot,
  "id" | "content" | "fileType"
>;

function projection(content: string, fileId: string) {
  recordDesignPerformance("buildCodeLayerProjection");
  return buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId },
  });
}

function mapNodeIds(
  before: string,
  oldId: string,
  after: string,
  newId: string,
  edits: readonly CodeLayerSourceEdit[] = [],
): Map<string, string> {
  return mapSourceNodeIds(
    projection(before, oldId).nodes,
    projection(after, newId).nodes,
    edits,
  );
}

export function prepareDeletedFileRestore(file: SourceFile) {
  const edits: CodeLayerSourceEdit[] = [];
  const content =
    file.fileType === "html"
      ? normalizeScreenHtml(file.content, {
          onSourceEdit: (edit) => edits.push(edit),
        }).content
      : file.content;
  mapNodeIds(file.content, file.id, content, file.id, edits);
  return {
    content,
    mapNodeIds: (newId: string) =>
      mapNodeIds(file.content, file.id, content, newId, edits),
  };
}

export function captureHistorySelectionSources<
  T extends GeometryHistorySelection,
>(selection: T, sources: HistorySources): T & GeometryHistorySelection {
  const selected = selection.selectedLayerIds.filter((id) => !(id in sources));
  if (selected.length === 0) return { ...selection, sourceContentByFileId: {} };
  const sourceContentByFileId: HistorySources = {};
  const sourceFileIdByFileId: Record<string, string> = {};
  for (const [fileId, content] of Object.entries(sources)) {
    const ids = new Set(
      projection(content, fileId).nodes.map((node) => node.id),
    );
    if (selected.some((id) => ids.has(id))) {
      sourceContentByFileId[fileId] = content;
      sourceFileIdByFileId[fileId] =
        selection.sourceContentByFileId?.[fileId] === content
          ? (selection.sourceFileIdByFileId?.[fileId] ?? fileId)
          : fileId;
    }
  }
  return { ...selection, sourceContentByFileId, sourceFileIdByFileId };
}

export function captureHistorySelectionFromOwners<
  T extends GeometryHistorySelection,
>(
  selection: T,
  owners: ReadonlyMap<string, { fileId: string }>,
  getContent: (fileId: string) => string,
): T & GeometryHistorySelection {
  const selectedFiles = new Set(
    selection.selectedLayerIds.flatMap((id) => {
      const owner = owners.get(id);
      return owner ? [owner.fileId] : [];
    }),
  );
  if (selectedFiles.size === 0)
    return { ...selection, sourceContentByFileId: {} };
  return captureHistorySelectionSources(
    selection,
    Object.fromEntries([...selectedFiles].map((id) => [id, getContent(id)])),
  );
}

export function remapHistorySelection<T extends GeometryHistorySelection>(
  selection: T,
  fileIds: ReadonlyMap<string, string>,
  sources: HistorySources = {},
): T & GeometryHistorySelection {
  const affected =
    (selection.activeFileId && fileIds.has(selection.activeFileId)) ||
    selection.overviewSelectedScreenIds.some((id) => fileIds.has(id)) ||
    selection.selectedLayerIds.some((id) => fileIds.has(id)) ||
    Object.keys(selection.sourceContentByFileId ?? {}).some((id) =>
      fileIds.has(id),
    ) ||
    Object.keys(sources).some((id) => fileIds.has(id));
  if (!affected) return selection;
  const sourceContentByFileId = {
    ...sources,
    ...selection.sourceContentByFileId,
  };
  const ids = new Map(fileIds);
  const provenIds = new Set<string>();
  const nextSources: HistorySources = {};
  const sourceFileIdByFileId: Record<string, string> = {};
  for (const [fileId, content] of Object.entries(sourceContentByFileId)) {
    const nextId = fileIds.get(fileId) ?? fileId;
    for (const [before, after] of mapNodeIds(
      content,
      fileId,
      content,
      nextId,
    )) {
      ids.set(before, after);
      provenIds.add(before);
    }
    nextSources[nextId] = content;
    sourceFileIdByFileId[nextId] =
      selection.sourceFileIdByFileId?.[fileId] ?? fileId;
  }
  const affectedActiveFile =
    !!selection.activeFileId && fileIds.has(selection.activeFileId);
  const selectedLayerIds = selection.selectedLayerIds.flatMap((id) => {
    if (ids.has(id)) return [ids.get(id)!];
    return affectedActiveFile && !provenIds.has(id) ? [] : [id];
  });
  const lostDescendants =
    selectedLayerIds.length === 0 && selection.selectedLayerIds.length > 0;
  return captureHistorySelectionSources(
    {
      ...selection,
      activeFileId: selection.activeFileId
        ? (fileIds.get(selection.activeFileId) ?? selection.activeFileId)
        : null,
      overviewSelectedScreenIds: lostDescendants
        ? []
        : selection.overviewSelectedScreenIds.map(
            (id) => fileIds.get(id) ?? id,
          ),
      selectedLayerIds,
      sourceContentByFileId: nextSources,
      sourceFileIdByFileId,
    },
    nextSources,
  );
}

function replayNodeIds(
  content: string,
  actual: string,
  fileId: string,
  originalFileId = fileId,
) {
  if (content === actual) return mapNodeIds(content, fileId, actual, fileId);
  for (const source of [
    undefined,
    ...[...new Set([fileId, originalFileId])].map((fileId) => ({
      kind: "design-file" as const,
      fileId,
    })),
  ]) {
    for (const normalize of [
      ensureCodeLayerNodeIdsInHtml,
      normalizeScreenHtml,
    ]) {
      const edits: CodeLayerSourceEdit[] = [];
      const normalized = normalize(content, {
        ...(source ? { source } : {}),
        onSourceEdit: (edit) => edits.push(edit),
      });
      if (normalized.content === actual)
        return mapNodeIds(content, fileId, actual, fileId, edits);
      const reverseEdits: CodeLayerSourceEdit[] = [];
      const reverse = normalize(actual, {
        ...(source ? { source } : {}),
        onSourceEdit: (edit) => reverseEdits.push(edit),
      });
      if (reverse.content === content) {
        return new Map(
          [...mapNodeIds(actual, fileId, content, fileId, reverseEdits)].map(
            ([from, to]) => [to, from],
          ),
        );
      }
    }
  }
  return new Map<string, string>();
}

export function resolveHistorySelection(
  selection: GeometryHistorySelection | undefined,
  actualSources: HistorySources,
  replaySources: HistorySources = {},
): {
  selection: GeometryHistorySelection | undefined;
  element: ReturnType<typeof elementInfoFromCodeLayerNode> | null;
} {
  if (!selection) return { selection, element: null };
  const sources = { ...replaySources, ...selection.sourceContentByFileId };
  const ids = new Map<string, string>();
  const targets = new Map<string, { node: CodeLayerNode; fileId: string }>();
  for (const [fileId, content] of Object.entries(actualSources)) {
    ids.set(fileId, fileId);
    const captured = sources[fileId];
    if (
      captured === undefined &&
      (selection.activeFileId !== fileId ||
        selection.selectedLayerIds.every((id) => id in actualSources))
    )
      continue;
    if (captured === undefined) {
      for (const node of projection(content, fileId).nodes)
        ids.set(node.id, node.id);
    } else {
      try {
        for (const [before, after] of replayNodeIds(
          captured,
          content,
          fileId,
          selection.sourceFileIdByFileId?.[fileId],
        ))
          ids.set(before, after);
      } catch {
        continue;
      }
    }
    for (const node of projection(content, fileId).nodes)
      targets.set(node.id, { node, fileId });
  }
  const selectedLayerIds = selection.selectedLayerIds.flatMap((id) =>
    ids.has(id) ? [ids.get(id)!] : [],
  );
  const selected =
    selectedLayerIds.length === 1
      ? targets.get(selectedLayerIds[0]!)
      : undefined;
  return {
    selection: {
      ...selection,
      activeFileId:
        selection.activeFileId && selection.activeFileId in actualSources
          ? selection.activeFileId
          : null,
      overviewSelectedScreenIds: selection.overviewSelectedScreenIds.filter(
        (id) =>
          id in actualSources &&
          (selectedLayerIds.length > 0 ||
            selection.selectedLayerIds.length === 0),
      ),
      selectedLayerIds,
    },
    element: selected
      ? canonicalElementInfoForCodeLayerNode(
          elementInfoFromCodeLayerNode(selected.node),
          selected.node,
          selected.fileId,
        )
      : null,
  };
}

function localAsSelection(
  snapshot: YjsUndoSelectionSnapshot,
  fileId: string,
): GeometryHistorySelection {
  return {
    activeFileId:
      snapshot.selectedElement?.sourceLayerIdentity?.screenId ?? fileId,
    overviewSelectedScreenIds: [],
    selectedLayerIds: snapshot.selectedLayerIds,
    sourceContentByFileId: snapshot.sourceContentByFileId,
    sourceFileIdByFileId: snapshot.sourceFileIdByFileId,
  };
}

export function resolveLocalHistorySelection(
  snapshot: YjsUndoSelectionSnapshot,
  fileId: string,
  content: string,
): YjsUndoSelectionSnapshot {
  const result = resolveHistorySelection(
    localAsSelection(snapshot, fileId),
    { [fileId]: content },
    { [fileId]: content },
  );
  return {
    ...snapshot,
    selectedElement: result.element,
    selectedLayerIds: result.selection!.selectedLayerIds,
  };
}

export function remapHistoryChange(
  change: ContentHistoryChange,
  fileIds: ReadonlyMap<string, string>,
): ContentHistoryChange {
  const fileId = fileIds.get(change.fileId) ?? change.fileId;
  const remapsData = [
    ...(change.designDataChange?.undo ?? []),
    ...(change.designDataChange?.redo ?? []),
  ].some(
    ({ path: [key, owner] }) =>
      owner &&
      fileIds.has(owner) &&
      ["canvasFrames", "screenMetadata", "localhostScreens"].includes(key),
  );
  if (fileId === change.fileId && !change.selectionBefore && !remapsData)
    return change;
  const snapshot = change.selectionBefore;
  let selectionBefore = snapshot;
  if (snapshot) {
    const original = localAsSelection(snapshot, change.fileId);
    const selection = remapHistorySelection(original, fileIds, {
      [change.fileId]: change.before,
    });
    if (selection !== original) {
      const resolved = resolveHistorySelection(
        selection,
        selection.sourceContentByFileId ?? {},
      );
      selectionBefore = {
        ...snapshot,
        selectedElement: resolved.element,
        selectedLayerIds: resolved.selection!.selectedLayerIds,
        sourceContentByFileId: selection.sourceContentByFileId,
        sourceFileIdByFileId: selection.sourceFileIdByFileId,
      };
    }
  }
  if (
    fileId === change.fileId &&
    selectionBefore === change.selectionBefore &&
    !remapsData
  )
    return change;
  const remapOperations = (
    operations: NonNullable<ContentHistoryChange["designDataChange"]>["undo"],
  ) =>
    operations.map((operation) => {
      const [key, owner, ...rest] = operation.path;
      const nextOwner =
        owner &&
        ["canvasFrames", "screenMetadata", "localhostScreens"].includes(key)
          ? fileIds.get(owner)
          : undefined;
      return nextOwner
        ? {
            ...operation,
            path: [key, nextOwner, ...rest] as typeof operation.path,
          }
        : operation;
    });
  return {
    ...change,
    fileId,
    ...(selectionBefore ? { selectionBefore } : {}),
    ...(change.designDataChange
      ? {
          designDataChange: {
            undo: remapOperations(change.designDataChange.undo),
            redo: remapOperations(change.designDataChange.redo),
          },
        }
      : {}),
  };
}

export function remapContentHistory(
  stack: readonly ContentHistoryEntry[],
  selections: readonly (GeometryHistorySelection | undefined)[],
  afterMap: ContentHistorySelectionAfterMap,
  fileIds: ReadonlyMap<string, string>,
) {
  const nextSelections: (GeometryHistorySelection | undefined)[] = [];
  const nextStack = stack.map((entry, index) => {
    const changes = "changes" in entry ? entry.changes : [entry];
    const before = Object.fromEntries(
      changes.map((change) => [change.fileId, change.before]),
    );
    const after = Object.fromEntries(
      changes.map((change) => [change.fileId, change.after]),
    );
    const mapped = changes.map((change) => remapHistoryChange(change, fileIds));
    const next = mapped.every((change, i) => change === changes[i])
      ? entry
      : "changes" in entry
        ? { ...entry, changes: mapped }
        : mapped[0]!;
    const selection = selections[index];
    nextSelections.push(
      selection ? remapHistorySelection(selection, fileIds, before) : selection,
    );
    const selectionAfter = afterMap.get(entry);
    if (selectionAfter)
      afterMap.set(next, remapHistorySelection(selectionAfter, fileIds, after));
    return next;
  });
  return { stack: nextStack, selections: nextSelections };
}

export function remapGeometryHistory(
  entry: GeometryHistoryEntry,
  fileIds: ReadonlyMap<string, string>,
): GeometryHistoryEntry {
  const remapFrames = (frames: GeometryHistoryEntry["before"]) =>
    Object.fromEntries(
      Object.entries(frames).map(([id, frame]) => [
        fileIds.get(id) ?? id,
        frame,
      ]),
    );
  return {
    ...entry,
    before: remapFrames(entry.before),
    after: remapFrames(entry.after),
    selectionBefore: entry.selectionBefore
      ? remapHistorySelection(
          entry.selectionBefore,
          fileIds,
          Object.fromEntries(
            (entry.linkedContentChanges ?? []).map((c) => [c.fileId, c.before]),
          ),
        )
      : undefined,
    selectionAfter: entry.selectionAfter
      ? remapHistorySelection(
          entry.selectionAfter,
          fileIds,
          Object.fromEntries(
            (entry.linkedContentChanges ?? []).map((c) => [c.fileId, c.after]),
          ),
        )
      : undefined,
    ...(entry.linkedContentChanges
      ? {
          linkedContentChanges: entry.linkedContentChanges.map((c) =>
            remapHistoryChange(c, fileIds),
          ),
        }
      : {}),
  };
}
