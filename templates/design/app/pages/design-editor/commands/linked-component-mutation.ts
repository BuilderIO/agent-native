import type { EditIntent } from "@shared/code-layer";
import type { ComponentDeletionGeometry } from "@shared/component-archive";
import {
  applyComponentPropertyEdit,
  applyComponentStructureIntent,
  applyComponentStructureEdit,
  applyComponentStyleTargetsEdit,
  resetComponentInstanceOverrides,
  type ComponentPropertyEdit,
  type ComponentSourceDocument,
} from "@shared/component-links";
import { sourceContentHash } from "@shared/source-workspace";
import type { RefObject } from "react";

import type { FileContentSaveRequest } from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryReservation,
  GeometryHistorySelection,
} from "@/pages/design-editor/history";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";

export type LinkedComponentEdit =
  | { kind: "style"; property: string; value: string }
  | { kind: "styleBatch"; values: Record<string, string> }
  | {
      kind: "styleTargetsBatch";
      targets: Array<{
        fileId: string;
        nodeId: string;
        styles: Record<string, string>;
      }>;
    }
  | { kind: "textContent"; value: string }
  | { kind: "layerName"; value: string }
  | { kind: "resetOverrides" }
  | { kind: "deleteMain"; deletionGeometry?: ComponentDeletionGeometry }
  | { kind: "restoreMain" }
  | {
      kind: "structure";
      before: string;
      after: string;
      selectionNodeIds?: string[];
    }
  | {
      kind: "structure";
      intents: EditIntent[];
    };

export interface LinkedComponentEditPayload {
  designId: string;
  fileId: string;
  nodeId: string;
  edit: LinkedComponentEdit;
  source: {
    expectedFiles: Array<{ fileId: string; versionHash: string }>;
  };
}

export interface LinkedComponentActionChange {
  fileId: string;
  before: string;
  after: string;
  beforeVersionHash: string;
  afterVersionHash: string;
  updatedAt: string;
}

export interface LinkedComponentActionResult {
  persisted?: boolean;
  conflict?: boolean;
  error?: string;
  ctaRequired?: boolean;
  ctaMessage?: string;
  selection?: {
    fileId: string;
    nodeIds: string[];
  };
  changes?: LinkedComponentActionChange[];
  sourceBases?: Array<{
    fileId: string;
    versionHash: string;
    updatedAt: string;
  }>;
}

interface LinkedComponentSaveGates {
  byFileId: Map<string, Promise<void>>;
  release: () => void;
}

export interface LinkedComponentMutationQueueArgs {
  designId: string;
  fileIds: () => string[];
  getContent: (fileId: string) => string;
  getSourceBaseContent: (fileId: string) => string;
  projectEdit?: (
    fileId: string,
    nodeId: string,
    edit: LinkedComponentEdit,
    contentByFileId: ReadonlyMap<string, string>,
  ) => ReadonlyMap<string, string> | null;
  canonicalizeSourceContent: (fileId: string, content: string) => string;
  flushPendingSaves: () => void;
  hasPendingSave: (fileId: string) => boolean;
  getPendingSave: (fileId: string) => FileContentSaveRequest | undefined;
  fileSaveChainsRef: RefObject<Record<string, Promise<void>>>;
  pendingFileSavesRef: RefObject<Record<string, FileContentSaveRequest>>;
  invokeAction: (
    payload: LinkedComponentEditPayload,
  ) => Promise<LinkedComponentActionResult>;
  applyFileContentUpdate: (
    fileId: string,
    content: string,
    options: {
      persist: false;
      recordHistory: false;
      historyBeforeContent: string;
      sourceBaseContent: string;
      updatedAt: string;
    },
  ) => ApplyFileContentUpdateResult;
  applySelection?: (
    selection: NonNullable<LinkedComponentActionResult["selection"]>,
  ) => GeometryHistorySelection | void;
  getCurrentSelection: () => GeometryHistorySelection;
  reserveContentHistory: (
    selectionBefore?: GeometryHistorySelection,
  ) => ContentHistoryReservation;
  waitForHostWrites: (fileIds: string[]) => Promise<void>;
  syncUndoRedoState: () => void;
  refreshAfterConflict: () => void | Promise<unknown>;
  reportFailure: (message: string) => void;
}

export function projectLinkedComponentPropertyEdit(args: {
  documents: readonly ComponentSourceDocument[];
  fileId: string;
  nodeId: string;
  edit: LinkedComponentEdit;
}): ReadonlyMap<string, string> | null {
  const projectChanges = (
    changes: readonly { fileId: string; after: string }[],
  ) => {
    const changed = new Map(
      changes.map((change) => [change.fileId, change.after]),
    );
    return new Map(
      args.documents.map((document) => [
        document.source.fileId ?? "",
        changed.get(document.source.fileId ?? "") ?? document.content,
      ]),
    );
  };
  if (args.edit.kind === "styleTargetsBatch") {
    const result = applyComponentStyleTargetsEdit({
      documents: args.documents,
      targets: args.edit.targets,
    });
    if (result.status !== "updated") return null;
    return projectChanges(result.changes);
  }
  if (args.edit.kind === "resetOverrides") {
    const result = resetComponentInstanceOverrides({
      documents: args.documents,
      instance: { fileId: args.fileId, nodeId: args.nodeId },
    });
    return result.status === "updated" ? projectChanges(result.changes) : null;
  }
  if (args.edit.kind === "structure") {
    const targetDocument = args.documents.find(
      (document) => document.source.fileId === args.fileId,
    );
    if (!targetDocument) return null;
    const mainBefore =
      "before" in args.edit ? args.edit.before : targetDocument.content;
    let mainAfter =
      "after" in args.edit ? args.edit.after : targetDocument.content;
    if ("intents" in args.edit) {
      for (const intent of args.edit.intents) {
        const patch = applyComponentStructureIntent({
          content: mainAfter,
          intent,
          source: targetDocument.source,
        });
        if (patch.result.status !== "applied") return null;
        mainAfter = patch.content;
      }
    }
    const result = applyComponentStructureEdit({
      documents: args.documents,
      target: { fileId: args.fileId, nodeId: args.nodeId },
      mainBefore,
      mainAfter,
    });
    return result.status === "updated" ? projectChanges(result.changes) : null;
  }
  const edits: ComponentPropertyEdit[] =
    args.edit.kind === "styleBatch"
      ? Object.entries(args.edit.values).map(([property, value]) => ({
          kind: "style" as const,
          property,
          value,
        }))
      : args.edit.kind === "style" ||
          args.edit.kind === "textContent" ||
          args.edit.kind === "layerName"
        ? [args.edit]
        : [];
  if (edits.length === 0) return null;

  let documents = [...args.documents];
  for (const edit of edits) {
    const result = applyComponentPropertyEdit({
      documents,
      target: { fileId: args.fileId, nodeId: args.nodeId },
      edit,
    });
    if (result.status !== "updated") return null;
    const changed = new Map(
      result.changes.map((change) => [change.fileId, change.after]),
    );
    documents = documents.map((document) => ({
      ...document,
      content: changed.get(document.source.fileId ?? "") ?? document.content,
    }));
  }
  return new Map(
    documents.map((document) => [
      document.source.fileId ?? "",
      document.content,
    ]),
  );
}

export interface LinkedComponentSourceMutationRequest<
  TResult extends LinkedComponentActionResult = LinkedComponentActionResult,
> {
  fileId: string;
  selectionBefore?: GeometryHistorySelection;
  run: (source: { content: string; versionHash: string }) => Promise<TResult>;
  validate: (
    result: TResult,
    source: {
      fileId: string;
      content: string;
      versionHash: string;
    },
  ) => LinkedComponentActionChange | null;
  onApplied?: () => void;
}

export interface LinkedComponentSourceMutationOutcome<
  TResult extends LinkedComponentActionResult,
> {
  result: TResult;
  historyRecorded: boolean;
  change?: LinkedComponentActionChange;
  hostSync: "skipped" | "accepted" | "deferred" | "refused";
}

interface QueueBatch {
  fileIds: string[];
  initialSourceContent: Map<string, string>;
  content: Map<string, string>;
  sourceBases: Map<
    string,
    { fileId: string; versionHash: string; updatedAt: string }
  >;
  gates: LinkedComponentSaveGates;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function acquireSaveGates(
  fileIds: readonly string[],
  chainsRef: RefObject<Record<string, Promise<void>>>,
): LinkedComponentSaveGates {
  const gates = fileIds.map((fileId) => {
    const previous = chainsRef.current[fileId] ?? Promise.resolve();
    const gate = deferred();
    const chain = previous.catch(() => {}).then(() => gate.promise);
    chainsRef.current[fileId] = chain;
    return { fileId, chain, resolve: gate.resolve };
  });
  return {
    byFileId: new Map(gates.map(({ fileId, chain }) => [fileId, chain])),
    release: () => {
      for (const { fileId, chain, resolve } of gates) {
        resolve();
        if (chainsRef.current[fileId] === chain) {
          delete chainsRef.current[fileId];
        }
      }
    },
  };
}

function failureMessage(result: LinkedComponentActionResult): string {
  return (
    result.error ??
    (result.ctaRequired
      ? (result.ctaMessage ?? "This edit requires an unavailable capability.")
      : result.conflict
        ? "The design changed while this component edit was being saved. Refresh and retry."
        : "The linked component edit could not be applied.")
  );
}

function validateActionResult(
  batch: QueueBatch,
  result: LinkedComponentActionResult,
): LinkedComponentActionChange[] {
  if (result.conflict || result.error || result.ctaRequired)
    throw new Error(failureMessage(result));
  const changes = result.changes ?? [];
  const nextBases = result.sourceBases ?? [];
  if (nextBases.length !== batch.fileIds.length) {
    throw new Error(
      "The linked component action returned an incomplete source version set.",
    );
  }
  const basesById = new Map(nextBases.map((base) => [base.fileId, base]));
  if (
    basesById.size !== batch.fileIds.length ||
    batch.fileIds.some((fileId) => !basesById.has(fileId))
  ) {
    throw new Error(
      "The linked component action returned a different source file set.",
    );
  }

  const changedById = new Map<string, LinkedComponentActionChange>();
  for (const change of changes) {
    const before = batch.content.get(change.fileId);
    const priorBase = batch.sourceBases.get(change.fileId);
    if (
      before === undefined ||
      !priorBase ||
      changedById.has(change.fileId) ||
      before !== change.before ||
      sourceContentHash(change.before) !== change.beforeVersionHash ||
      sourceContentHash(change.after) !== change.afterVersionHash ||
      !change.updatedAt
    ) {
      throw new Error(
        "The linked component action returned a stale or invalid file change.",
      );
    }
    changedById.set(change.fileId, change);
  }

  for (const fileId of batch.fileIds) {
    const nextBase = basesById.get(fileId)!;
    const expectedHash =
      changedById.get(fileId)?.afterVersionHash ??
      batch.sourceBases.get(fileId)?.versionHash;
    if (
      !nextBase.updatedAt ||
      !expectedHash ||
      nextBase.versionHash !== expectedHash
    ) {
      throw new Error(
        "The linked component action returned a stale source version.",
      );
    }
  }
  if (changes.length > 0 && result.persisted !== true) {
    throw new Error("The linked component action did not confirm persistence.");
  }
  return changes;
}

function validateActionSelection(
  batch: QueueBatch,
  selection: unknown,
): NonNullable<LinkedComponentActionResult["selection"]> | undefined {
  if (selection === undefined) return undefined;
  if (typeof selection !== "object") {
    throw new Error(
      "The linked component action returned an invalid durable selection.",
    );
  }
  const candidate = selection as {
    fileId?: unknown;
    nodeIds?: unknown;
  };
  if (
    typeof candidate.fileId !== "string" ||
    candidate.fileId.trim().length === 0 ||
    !batch.fileIds.includes(candidate.fileId) ||
    !Array.isArray(candidate.nodeIds) ||
    candidate.nodeIds.some(
      (nodeId) => typeof nodeId !== "string" || nodeId.trim().length === 0,
    ) ||
    new Set(candidate.nodeIds).size !== candidate.nodeIds.length
  ) {
    throw new Error(
      "The linked component action returned an invalid durable selection.",
    );
  }
  return {
    fileId: candidate.fileId,
    nodeIds: candidate.nodeIds as string[],
  };
}

function assertResponseMatchesProjection(
  batch: QueueBatch,
  changes: readonly LinkedComponentActionChange[],
  projected?: ReadonlyMap<string, string> | null,
): void {
  if (!projected) return;
  const changedById = new Map(changes.map((change) => [change.fileId, change]));
  if (
    batch.fileIds.some(
      (fileId) =>
        projected.get(fileId) !==
        (changedById.get(fileId)?.after ?? batch.content.get(fileId)),
    )
  ) {
    throw new Error(
      "The linked component action did not match its projected source update.",
    );
  }
}

function assertEditorSourceUnchanged(
  args: LinkedComponentMutationQueueArgs,
  batch: QueueBatch,
  allowedResponseChanges: readonly LinkedComponentActionChange[] = [],
  projectedContent?: ReadonlyMap<string, string> | null,
): void {
  const allowedSourceContent = new Map<string, Set<string>>();
  for (const fileId of batch.fileIds) {
    allowedSourceContent.set(
      fileId,
      new Set([
        batch.initialSourceContent.get(fileId) ?? "",
        batch.content.get(fileId) ?? "",
      ]),
    );
  }
  for (const change of allowedResponseChanges) {
    allowedSourceContent.get(change.fileId)?.add(change.after);
  }
  if (
    batch.fileIds.some((fileId) => {
      const pendingSave = args.getPendingSave(fileId);
      const projected = projectedContent?.get(fileId);
      const projectedHash =
        projected === undefined ? undefined : sourceContentHash(projected);
      const causallyComposedPendingSave = Boolean(
        pendingSave &&
        projected !== undefined &&
        pendingSave.expectedVersionHash === projectedHash &&
        args.getContent(fileId) ===
          args.canonicalizeSourceContent(fileId, pendingSave.content),
      );
      if (causallyComposedPendingSave) return false;
      const acceptedSource = allowedSourceContent.get(fileId)!;
      const sourceContent = args.getSourceBaseContent(fileId);
      const sourceAccepted = acceptedSource.has(sourceContent);
      const editorAccepted = [...acceptedSource].some(
        (content) =>
          args.getContent(fileId) ===
          args.canonicalizeSourceContent(fileId, content),
      );
      return (
        !sourceAccepted ||
        !editorAccepted ||
        args.hasPendingSave(fileId) ||
        Boolean(args.pendingFileSavesRef.current[fileId]) ||
        (args.fileSaveChainsRef.current[fileId] !== undefined &&
          args.fileSaveChainsRef.current[fileId] !==
            batch.gates.byFileId.get(fileId))
      );
    })
  ) {
    throw new Error(
      "A newer editor change arrived during the linked component edit. Refresh the design and retry.",
    );
  }
}

function selectionRecordEquals(
  left?: Record<string, string>,
  right?: Record<string, string>,
): boolean {
  if (!left || !right) return left === right;
  return Object.entries(right).every(([key, value]) => left[key] === value);
}

function selectionEquals(
  left: GeometryHistorySelection,
  right: GeometryHistorySelection,
): boolean {
  return (
    left.activeFileId === right.activeFileId &&
    left.selectedLayerIds.length === right.selectedLayerIds.length &&
    left.selectedLayerIds.every(
      (nodeId, index) => nodeId === right.selectedLayerIds[index],
    ) &&
    left.overviewSelectedScreenIds.length ===
      right.overviewSelectedScreenIds.length &&
    left.overviewSelectedScreenIds.every(
      (fileId, index) => fileId === right.overviewSelectedScreenIds[index],
    ) &&
    selectionRecordEquals(
      left.sourceContentByFileId,
      right.sourceContentByFileId,
    ) &&
    selectionRecordEquals(left.sourceFileIdByFileId, right.sourceFileIdByFileId)
  );
}

function selectionAfterChanges(
  selection: GeometryHistorySelection,
  changes: readonly LinkedComponentActionChange[],
  canonicalize: (fileId: string, content: string) => string,
): GeometryHistorySelection {
  if (!selection.sourceContentByFileId) return selection;
  const changedByFileId = new Map(
    changes.map((change) => [change.fileId, change.after]),
  );
  const sourceContentByFileId = Object.fromEntries(
    Object.entries(selection.sourceContentByFileId).map(([fileId, content]) => {
      const changed = changedByFileId.get(fileId);
      return [
        fileId,
        changed === undefined ? content : canonicalize(fileId, changed),
      ];
    }),
  );
  return { ...selection, sourceContentByFileId };
}

function createBatch(
  args: LinkedComponentMutationQueueArgs,
  fileIds: string[],
  gates: LinkedComponentSaveGates,
): QueueBatch {
  const initialSourceContent = new Map(
    fileIds.map((fileId) => [fileId, args.getSourceBaseContent(fileId)]),
  );
  const sourceBases = new Map(
    fileIds.map((fileId) => {
      const content = initialSourceContent.get(fileId)!;
      return [
        fileId,
        {
          fileId,
          versionHash: sourceContentHash(content),
          updatedAt: "editor-base",
        },
      ] as const;
    }),
  );
  return {
    fileIds,
    initialSourceContent,
    content: new Map(initialSourceContent),
    sourceBases,
    gates,
  };
}

export function createLinkedComponentMutationQueue(
  args: LinkedComponentMutationQueueArgs,
) {
  let chain: Promise<void> = Promise.resolve();
  let queued = 0;
  let barriers = 0;
  let batch: QueueBatch | null = null;
  let failure: Error | null = null;
  let observing = false;
  let unprojected = 0;
  let externalCheckpoints: Array<{
    change: ContentHistoryChange;
    record: () => void;
  }> = [];
  const acknowledgedContent = new Map<string, string>();
  const projectedContent = new Map<string, string>();

  const releaseBatch = () => {
    batch?.gates.release();
    batch = null;
    projectedContent.clear();
  };
  const startBatch = async (): Promise<QueueBatch> => {
    const fileIds = [...new Set(args.fileIds())].sort();
    if (fileIds.length === 0)
      throw new Error(
        "No HTML source files are available for this linked component.",
      );
    await args.waitForHostWrites(fileIds);
    args.flushPendingSaves();
    await Promise.all(
      fileIds.map((fileId) => args.fileSaveChainsRef.current[fileId]),
    );
    if (fileIds.some(args.hasPendingSave)) {
      args.flushPendingSaves();
      await Promise.all(
        fileIds.map((fileId) => args.fileSaveChainsRef.current[fileId]),
      );
    }
    const gates = acquireSaveGates(fileIds, args.fileSaveChainsRef);
    try {
      return createBatch(args, fileIds, gates);
    } catch (error) {
      gates.release();
      throw error;
    }
  };
  const drainExternalCheckpoints = (
    changes: readonly LinkedComponentActionChange[],
  ) => {
    observing = false;
    for (const change of changes) {
      acknowledgedContent.set(
        change.fileId,
        args.canonicalizeSourceContent(change.fileId, change.after),
      );
    }
    const checkpoints = externalCheckpoints;
    externalCheckpoints = [];
    for (const { change, record } of checkpoints) {
      if (acknowledgedContent.get(change.fileId) !== change.after) record();
    }
  };
  const schedule = <T>(run: () => Promise<T>): Promise<T> => {
    queued += 1;
    args.syncUndoRedoState();
    const operation = chain.then(run).finally(() => {
      queued -= 1;
      if (queued === 0) {
        releaseBatch();
        failure = null;
      }
      args.syncUndoRedoState();
    });
    chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  type MutationPreparation<TResult extends LinkedComponentActionResult> = {
    result: TResult;
    changes: LinkedComponentActionChange[];
    skip?: boolean;
    nextSourceBases: Map<
      string,
      { fileId: string; versionHash: string; updatedAt: string }
    >;
  };
  const runQueuedMutation = async <TResult extends LinkedComponentActionResult>(
    selectionBefore: GeometryHistorySelection,
    reservationRef: { current: ContentHistoryReservation | undefined },
    prepare: (activeBatch: QueueBatch) => Promise<MutationPreparation<TResult>>,
    onApplied?: () => void, // i18n-ignore TypeScript callback signature, not UI copy
    projected?: ReadonlyMap<string, string> | null,
  ): Promise<LinkedComponentSourceMutationOutcome<TResult>> => {
    let changes: LinkedComponentActionChange[] = [];
    let confirmed = false;
    try {
      if (failure) throw failure;
      reservationRef.current ??= args.reserveContentHistory(selectionBefore);
      const activeBatch = (batch ??= await startBatch());
      assertEditorSourceUnchanged(args, activeBatch, [], projectedContent);
      observing = true;
      const preparation = await prepare(activeBatch);
      changes = preparation.changes;
      if (preparation.skip) {
        reservationRef.current.cancel();
        reservationRef.current = undefined;
        return {
          result: preparation.result,
          historyRecorded: false,
          hostSync: "skipped",
        };
      }
      for (const change of changes)
        acknowledgedContent.set(
          change.fileId,
          args.canonicalizeSourceContent(change.fileId, change.after),
        );
      assertResponseMatchesProjection(activeBatch, changes, projected);
      const historyChanges = changes.map(({ fileId, before, after }) => ({
        fileId,
        before: args.canonicalizeSourceContent(fileId, before),
        after: args.canonicalizeSourceContent(fileId, after),
      }));
      reservationRef.current.commit(historyChanges);
      confirmed = true;
      const selection = validateActionSelection(
        activeBatch,
        preparation.result.selection,
      );
      assertEditorSourceUnchanged(args, activeBatch, changes, projectedContent);
      await args.waitForHostWrites(activeBatch.fileIds);
      assertEditorSourceUnchanged(args, activeBatch, changes, projectedContent);
      let hostSync: "accepted" | "deferred" = "accepted";
      for (const change of changes) {
        const pendingSave = args.getPendingSave(change.fileId);
        const latestProjected = projectedContent.get(change.fileId);
        if (
          pendingSave &&
          latestProjected !== undefined &&
          pendingSave.expectedVersionHash ===
            sourceContentHash(latestProjected) &&
          args.getContent(change.fileId) ===
            args.canonicalizeSourceContent(change.fileId, pendingSave.content)
        ) {
          activeBatch.content.set(change.fileId, change.after);
          continue;
        }
        const applied = args.applyFileContentUpdate(
          change.fileId,
          change.after,
          {
            persist: false,
            recordHistory: false,
            historyBeforeContent: change.before,
            sourceBaseContent: change.before,
            updatedAt: change.updatedAt,
          },
        );
        if (applied.status === "deferred") {
          hostSync = "deferred";
          await args.waitForHostWrites([change.fileId]);
          if (
            args.getContent(change.fileId) !==
            args.canonicalizeSourceContent(change.fileId, change.after)
          ) {
            throw new Error(
              "The saved linked component update has not reached the editor.",
            );
          }
        } else if (applied.status !== "accepted") {
          throw new Error(
            "The editor refused the saved linked component update.",
          );
        }
        activeBatch.content.set(change.fileId, change.after);
      }
      activeBatch.sourceBases = preparation.nextSourceBases;
      if (
        selection &&
        args.applySelection &&
        selectionEquals(
          args.getCurrentSelection(),
          selectionAfterChanges(
            selectionBefore,
            changes,
            args.canonicalizeSourceContent,
          ),
        )
      ) {
        const selectionAfter = args.applySelection(selection);
        if (selectionAfter) {
          reservationRef.current.commit(historyChanges, selectionAfter);
        }
      }
      onApplied?.();
      return {
        result: preparation.result,
        historyRecorded: true,
        change: changes.length === 1 ? changes[0] : undefined,
        hostSync,
      };
    } catch (error) {
      if (!confirmed) reservationRef.current?.cancel();
      if (!failure) {
        failure = error instanceof Error ? error : new Error(String(error));
        releaseBatch();
        const message = failure.message;
        try {
          await args.refreshAfterConflict();
          if (
            confirmed &&
            changes.length > 0 &&
            changes.every(
              (change) =>
                args.getContent(change.fileId) ===
                args.canonicalizeSourceContent(change.fileId, change.after),
            )
          ) {
            failure = null;
          }
        } finally {
          args.reportFailure(message);
        }
      }
      throw error;
    } finally {
      drainExternalCheckpoints(changes);
    }
  };
  return {
    hasPending: () => queued > 0,
    blocksLocalContentEdits: () => unprojected > 0,
    getProjectedContent: (fileId: string) => projectedContent.get(fileId),
    interceptExternalCheckpoint: (
      change: ContentHistoryChange,
      record: () => void,
    ): boolean => {
      if (acknowledgedContent.get(change.fileId) === change.after) return true;
      acknowledgedContent.delete(change.fileId);
      if (!observing || !batch?.fileIds.includes(change.fileId)) return false;
      externalCheckpoints.push({ change, record });
      return true;
    },
    enqueue: (
      fileId: string,
      nodeId: string,
      edit: LinkedComponentEdit,
      selectionBefore?: GeometryHistorySelection,
      onApplied?: () => void,
    ): Promise<void> => {
      const selectionAtEnqueue = selectionBefore ?? args.getCurrentSelection();
      const fileIds = [...new Set(args.fileIds())].sort();
      const projected =
        unprojected > 0
          ? null
          : args.projectEdit?.(
              fileId,
              nodeId,
              edit,
              new Map(
                fileIds.map((id) => [
                  id,
                  projectedContent.get(id) ?? args.getContent(id),
                ]),
              ),
            );
      if (projected) {
        for (const [id, content] of projected) {
          if (fileIds.includes(id)) projectedContent.set(id, content);
        }
      } else {
        unprojected += 1;
      }
      const reservationRef = {
        current:
          barriers === 0
            ? args.reserveContentHistory(selectionAtEnqueue)
            : undefined,
      };
      if (queued === 0) failure = null;
      return schedule(() =>
        runQueuedMutation(
          selectionAtEnqueue,
          reservationRef,
          async (activeBatch) => {
            const result = await args.invokeAction({
              designId: args.designId,
              fileId,
              nodeId,
              edit,
              source: {
                expectedFiles: activeBatch.fileIds.map((id) => ({
                  fileId: id,
                  versionHash: activeBatch.sourceBases.get(id)!.versionHash,
                })),
              },
            });
            return {
              result,
              changes: validateActionResult(activeBatch, result),
              nextSourceBases: new Map(
                result.sourceBases!.map((base) => [base.fileId, base]),
              ),
            };
          },
          onApplied,
          projected,
        ),
      )
        .finally(() => {
          if (!projected) unprojected -= 1;
        })
        .then(() => undefined);
    },
    enqueueSourceMutation: <TResult extends LinkedComponentActionResult>(
      request: LinkedComponentSourceMutationRequest<TResult>,
    ): Promise<LinkedComponentSourceMutationOutcome<TResult>> => {
      const selectionAtEnqueue =
        request.selectionBefore ?? args.getCurrentSelection();
      const reservationRef = {
        current:
          barriers === 0
            ? args.reserveContentHistory(selectionAtEnqueue)
            : undefined,
      };
      if (queued === 0) failure = null;
      return schedule(() =>
        runQueuedMutation(
          selectionAtEnqueue,
          reservationRef,
          async (activeBatch) => {
            const before = activeBatch.content.get(request.fileId);
            const sourceBase = activeBatch.sourceBases.get(request.fileId);
            if (before === undefined || !sourceBase) {
              throw new Error(
                "The source mutation target is not an available HTML file.",
              );
            }
            const source = {
              content: before,
              versionHash: sourceBase.versionHash,
            };
            const result = await request.run(source);
            const validatedChange = request.validate(result, {
              fileId: request.fileId,
              ...source,
            });
            if (result.persisted !== true) {
              if (validatedChange || (result.changes?.length ?? 0) > 0) {
                throw new Error(
                  "The source mutation returned changes without confirming persistence.",
                );
              }
              return {
                result,
                changes: [],
                skip: true,
                nextSourceBases: activeBatch.sourceBases,
              };
            }
            if (!validatedChange) {
              throw new Error(
                "The source mutation returned a stale or invalid persisted file change.",
              );
            }
            const returnedSourceBases = result.sourceBases ?? [];
            if (
              returnedSourceBases.length !== 1 ||
              returnedSourceBases[0]?.fileId !== request.fileId
            ) {
              throw new Error(
                "The source mutation returned a different source file set.",
              );
            }
            const normalizedResult: LinkedComponentActionResult = {
              ...result,
              sourceBases: activeBatch.fileIds.map((fileId) =>
                fileId === request.fileId
                  ? returnedSourceBases[0]!
                  : activeBatch.sourceBases.get(fileId)!,
              ),
            };
            const changes = validateActionResult(activeBatch, normalizedResult);
            if (changes.length !== 1 || changes[0]?.fileId !== request.fileId) {
              throw new Error(
                "The source mutation returned a different source file set.",
              );
            }
            return {
              result,
              changes,
              nextSourceBases: new Map(
                normalizedResult.sourceBases!.map((base) => [
                  base.fileId,
                  base,
                ]),
              ),
            };
          },
          request.onApplied,
        ),
      );
    },
    deferHistoryChange: (run: () => void): boolean => {
      if (barriers === 0) return false;
      void schedule(async () => run()).catch((error) =>
        args.reportFailure(String(error)),
      );
      return true;
    },
    dispatchHistory: (run: () => void): void | Promise<void> => {
      if (queued === 0 && !failure) {
        run();
        return;
      }
      barriers += 1;
      return schedule(async () => {
        releaseBatch();
        barriers -= 1;
        if (failure) {
          failure = null;
          return;
        }
        run();
      });
    },
  };
}
