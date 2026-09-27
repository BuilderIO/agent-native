import {
  parseScrubRelativeExpression,
  type ScrubRelativeExpression,
} from "@agent-native/toolkit/design-tweaks";
import { isStandaloneHttpUrl } from "@shared/html-content";

import { trace } from "@/components/design/design-trace";

import { normalizeDesignLeftPanel } from "./tool-state";
import {
  type DesignFile,
  type DesignLeftPanel,
  type DesignTool,
  type EditorMode,
} from "./types";

export { isStandaloneHttpUrl };

export type PreviewContentReplaceResult =
  | "applied"
  | "skipped-live-route"
  | "skipped-caller-owns-preview"
  | "unavailable";

export function previewContentReplaceNeedsRenderFallback(
  result: PreviewContentReplaceResult,
): boolean {
  if (result !== "unavailable") return false;
  trace("persist", "preview-bridge-unavailable-reload");
  return true;
}

export function resolveLocalhostSourceWriteContent(args: {
  extension: string;
  persistedContent: string | null | undefined;
  liveSnapshotHtml: string | null | undefined;
}): string | null {
  const extension = args.extension.trim().toLowerCase();
  const candidate =
    extension === ".html" || extension === ".htm"
      ? args.liveSnapshotHtml
      : extension === ".css"
        ? args.persistedContent
        : null;
  if (!candidate?.trim() || isStandaloneHttpUrl(candidate)) return null;
  return candidate;
}

export type PersistedContentHostSyncOptions = {
  forcePreviewFullDocument: boolean;
  persist: false;
  shaderWriteCompletion?: true;
  updatedAt?: string;
};

export type PersistedContentHostSyncWriter = (
  fileId: string,
  content: string,
  options: PersistedContentHostSyncOptions,
) => void;

export type PersistedContentHostSyncHandler = (
  fileId: string,
  content: string,
  updatedAt?: string,
) => void;

export function getPersistedContentHostSyncOptions(args: {
  fileId: string;
  activeFileId: string | null | undefined;
  updatedAt?: string;
  shaderWriteCompletion?: true;
}): PersistedContentHostSyncOptions {
  return {
    forcePreviewFullDocument:
      args.activeFileId !== null &&
      args.activeFileId !== undefined &&
      args.fileId === args.activeFileId,
    persist: false,
    ...(args.shaderWriteCompletion ? { shaderWriteCompletion: true } : {}),
    updatedAt: args.updatedAt,
  };
}

export function createPersistedContentHostSyncHandler(args: {
  activeFileIdRef: { current: string | null | undefined };
  applyFileContentUpdateRef: { current: PersistedContentHostSyncWriter };
  shaderWriteCompletion?: true;
}): PersistedContentHostSyncHandler {
  return (fileId, content, updatedAt) => {
    args.applyFileContentUpdateRef.current(
      fileId,
      content,
      getPersistedContentHostSyncOptions({
        fileId,
        activeFileId: args.activeFileIdRef.current,
        updatedAt,
        shaderWriteCompletion: args.shaderWriteCompletion,
      }),
    );
  };
}

export function getDesignEditorShareUrl(
  id: string,
  origin: string,
  basePath = "",
  surface: "design" | "visual-edit" = "design",
) {
  const normalizedBasePath = basePath.replace(/\/+$/, "");
  const pathname = normalizedBasePath
    ? `${normalizedBasePath}/${surface}/${encodeURIComponent(id)}`
    : `/${surface}/${encodeURIComponent(id)}`;
  const url = new URL(pathname, origin);
  if (surface === "visual-edit") url.searchParams.set("share", "1");
  return url.toString();
}

function formatDesignEditorUrlZoom(zoom: number): string {
  const rounded = Math.round(zoom * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function getDesignEditorStateUrlSearch(args: {
  currentSearch: string;
  viewMode: "single" | "overview";
  screenId?: string | null;
  codeFileId?: string | null;
  codeFilename?: string | null;
  selectionId?: string | null;
  leftPanel?: DesignLeftPanel | null;
  zoom?: number | null;
  tool?: DesignTool | null;
  mode?: EditorMode | null;
}) {
  const currentParams = new URLSearchParams(args.currentSearch);
  const params = new URLSearchParams();
  let editorViewWritten = false;
  for (const [key, value] of currentParams) {
    if (key === "view" || key === "editorView") {
      if (!editorViewWritten) {
        params.set("editorView", args.viewMode);
        editorViewWritten = true;
      }
      continue;
    }
    params.append(key, value);
  }
  if (!editorViewWritten) params.set("editorView", args.viewMode);
  const leftPanel = normalizeDesignLeftPanel(args.leftPanel) ?? null;
  if (leftPanel && leftPanel !== "file") {
    params.set("panel", leftPanel);
  } else {
    params.delete("panel");
  }
  if (args.screenId) {
    params.set("screen", args.screenId);
  } else {
    params.delete("screen");
  }
  if (leftPanel === "code" && args.codeFileId) {
    params.set("fileId", args.codeFileId);
  } else {
    params.delete("fileId");
  }
  if (leftPanel === "code" && !args.codeFileId && args.codeFilename) {
    params.set("filename", args.codeFilename);
  } else {
    params.delete("filename");
  }
  if (args.selectionId) {
    params.set("selection", args.selectionId);
  } else {
    params.delete("selection");
  }
  if (typeof args.zoom === "number" && Number.isFinite(args.zoom)) {
    params.set("zoom", formatDesignEditorUrlZoom(args.zoom));
  } else {
    params.delete("zoom");
  }
  if (args.tool && args.tool !== "move") {
    params.set("tool", args.tool);
  } else {
    params.delete("tool");
  }
  if (args.viewMode === "single") {
    params.set("mode", "interact");
  } else {
    params.delete("mode");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getLocalhostRouteSourceFile(args: {
  sourceFile?: string;
  source?: string;
}): string | undefined {
  if (args.sourceFile?.trim()) return args.sourceFile;
  const raw = args.source;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "file" in parsed &&
      typeof (parsed as Record<string, unknown>).file === "string"
    ) {
      return (parsed as Record<string, string>).file;
    }
  } catch {
    if (raw.length > 0) return raw;
  }
  return undefined;
}

export function getLayerMoveSourceContent(args: {
  sourceFileId: string;
  activeFileId?: string | null;
  activeContent: string;
  sourceFileContent?: string;
  sourceContentMap: ReadonlyMap<string, string>;
}) {
  return (
    args.sourceContentMap.get(args.sourceFileId) ??
    (args.sourceFileId === args.activeFileId
      ? args.activeContent
      : args.sourceFileContent) ??
    ""
  );
}

export function getFreshActiveFileContent(args: {
  activeContent: string;
  pendingContent?: string | null;
  latestContent?: string | null;
  lastLocalContent?: string | null;
}) {
  return (
    args.pendingContent ??
    args.latestContent ??
    args.lastLocalContent ??
    args.activeContent
  );
}

export function getFreshScreenContent(args: {
  screenId: string;
  activeFileId?: string | null;
  freshActiveContentFileId?: string | null;
  freshActiveContent: string;
  fileContentById: ReadonlyMap<string, string>;
  pendingContent?: string | null;
}) {
  const freshActiveContentFileId =
    args.freshActiveContentFileId ?? args.activeFileId;
  if (
    args.screenId === args.activeFileId &&
    args.screenId === freshActiveContentFileId
  ) {
    return args.freshActiveContent;
  }
  return args.pendingContent ?? args.fileContentById.get(args.screenId) ?? "";
}

export function shouldReplacePreviewAfterVisualStyleCommit(args: {
  runtimeApplied?: boolean;
  runtimeStyleApplied: boolean;
}) {
  return !args.runtimeApplied && !args.runtimeStyleApplied;
}

export interface OptimisticTextDecorationLineEntry {
  key: string;
  value: string;
}

/**
 * BUG-DOUBLE-TOGGLE-RACE — Cmd+U (toggle underline) / Cmd+Shift+X (toggle
 * strikethrough) commit through the SHORTHAND "textDecoration" property, but
 * commitVisualStyles' synchronous optimistic patch to
 * selectedElement.computedStyles only merges the exact key(s) it committed —
 * it never decomposes "textDecoration" into the LONGHAND
 * "textDecorationLine" the toggle reads to decide its next value.
 * `computedStyles.textDecorationLine` only catches up once the bridge's
 * async getComputedStyle round trip lands. A second toggle press within that
 * window would otherwise recompute nextTextDecorationLineValue from the
 * STALE pre-toggle value, land on the exact value the first press already
 * committed, and get deduped as a no-op — consecutive toggles silently stop
 * alternating.
 *
 * Resolves which value a toggle handler should treat as "current": a
 * still-fresh optimistic value this same toggle family already recorded for
 * the SAME selected element (`tracked.key === elementKey`) wins over the
 * (possibly stale) computedStyles reading, since the async measurement that
 * would refresh computedStyles may not have landed yet. A different/new
 * element key (or no tracked entry) falls back to computedStyles, so newly
 * selecting a different element always starts from ITS OWN real state.
 */
export function resolveOptimisticTextDecorationLine(
  tracked: OptimisticTextDecorationLineEntry | null | undefined,
  elementKey: string | undefined,
  computedTextDecorationLine: string | undefined,
): string | undefined {
  if (tracked && elementKey !== undefined && tracked.key === elementKey) {
    return tracked.value;
  }
  return computedTextDecorationLine;
}

export function shouldSkipVisualStyleCommitForPreview(args: {
  phase?: "preview" | "commit";
  selectedLayerCount: number;
}): boolean {
  return args.phase === "preview" && args.selectedLayerCount <= 1;
}

export function applyRelativeDeltaToStyleValue(
  currentValue: string | undefined,
  delta: number,
): string | null {
  if (typeof currentValue !== "string") return null;
  const match = currentValue.trim().match(/^(-?\d*\.?\d+)(.*)$/);
  if (!match) return null;
  const [, numeric, unit] = match;
  const base = Number(numeric);
  if (!Number.isFinite(base)) return null;
  const next = base + delta;
  const rounded = Math.round(next * 1e6) / 1e6;
  return `${Object.is(rounded, -0) ? 0 : rounded}${unit ?? ""}`;
}

export function applyRelativeExpressionToStyleValue(
  currentValue: string | undefined,
  relativeExpression: ScrubRelativeExpression,
): string | null {
  if (typeof currentValue !== "string") return null;
  const match = currentValue.trim().match(/^(-?\d*\.?\d+)(.*)$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = relativeExpression.unit ?? match[2]?.trim() ?? undefined;
  const parsed = parseScrubRelativeExpression(
    relativeExpression.expression,
    base,
    {
      unit: unit || undefined,
      min: relativeExpression.min,
      max: relativeExpression.max,
      precision: relativeExpression.precision,
    },
  );
  return parsed?.normalized ?? null;
}

export function getLayerMoveIterationOrder<T>(
  orderedIds: readonly T[],
  placement: "before" | "after" | "inside",
): T[] {
  return placement === "after" ? [...orderedIds].reverse() : [...orderedIds];
}

export function removeUndoRedoOrderKind<T extends string>(
  order: readonly T[],
  kind: T,
): T[] {
  return order.filter((entry) => entry !== kind);
}

export type UndoRedoOrderKind =
  | "content"
  | "file-content"
  | "geometry"
  | "clipboard-paste"
  | "file-created"
  | "file-deleted"
  | "pending-style"
  | "pending-live";

export function getUndoRedoPriorityOrder(
  preferred: UndoRedoOrderKind | undefined,
): UndoRedoOrderKind[] {
  if (preferred === "clipboard-paste") return ["clipboard-paste"];
  if (preferred === "file-deleted")
    return [
      "file-deleted",
      "file-created",
      "content",
      "file-content",
      "geometry",
    ];
  if (preferred === "file-created")
    return [
      "file-created",
      "file-deleted",
      "content",
      "file-content",
      "geometry",
    ];
  if (preferred === "geometry") return ["geometry", "content", "file-content"];
  if (preferred === "file-content")
    return ["file-content", "content", "geometry"];
  return ["content", "file-content", "geometry"];
}

export interface PendingLocalFileContent {
  content: string;
  startedAt: number;
  baseUpdatedAt?: string | null;
  baseContent?: string;
  identityMigrationSourceContent?: string;
  identityMigrationStoredContent?: string;
  identityMigrationStoredUpdatedAt?: string | null;
}

export function createPendingLocalFileContent(args: {
  current?: PendingLocalFileContent;
  file?: { content?: string | null; updatedAt?: string | null };
  content: string;
  baseUpdatedAt?: string | null;
  identityMigrationSourceContent?: string;
}): PendingLocalFileContent {
  const {
    current,
    file,
    content,
    baseUpdatedAt,
    identityMigrationSourceContent,
  } = args;
  const sameContent = current?.content === content;
  const sameMigration =
    current?.identityMigrationSourceContent === identityMigrationSourceContent;
  return {
    content,
    startedAt: sameContent ? current.startedAt : Date.now(),
    baseUpdatedAt:
      current?.baseUpdatedAt !== undefined
        ? current.baseUpdatedAt
        : baseUpdatedAt !== undefined
          ? baseUpdatedAt
          : file?.updatedAt,
    baseContent: current
      ? current.baseContent
      : file
        ? (file.content ?? "")
        : undefined,
    identityMigrationSourceContent,
    identityMigrationStoredContent:
      identityMigrationSourceContent === undefined
        ? undefined
        : sameContent && sameMigration
          ? current.identityMigrationStoredContent
          : (file?.content ?? ""),
    identityMigrationStoredUpdatedAt:
      identityMigrationSourceContent === undefined
        ? undefined
        : sameContent && sameMigration
          ? current.identityMigrationStoredUpdatedAt
          : (file?.updatedAt ?? null),
  };
}

export function restorePendingFileContent<
  T extends {
    files?: Array<{
      id: string;
      content?: string | null;
      updatedAt?: string | null;
    }>;
  },
>(
  design: T,
  fileId: string,
  pending: PendingLocalFileContent,
  expectedContent: string,
): T {
  if (
    pending.content !== expectedContent ||
    pending.baseContent === undefined ||
    !Array.isArray(design.files)
  ) {
    return design;
  }
  return {
    ...design,
    files: design.files.map((file) => {
      if (file.id !== fileId || file.content !== expectedContent) return file;
      if (
        pending.baseUpdatedAt !== undefined &&
        file.updatedAt !== pending.baseUpdatedAt
      ) {
        return file;
      }
      return {
        ...file,
        content: pending.baseContent,
        ...(pending.baseUpdatedAt !== undefined
          ? { updatedAt: pending.baseUpdatedAt }
          : {}),
      };
    }),
  };
}

export interface FileContentSaveRequest {
  identityMigrationSourceContent?: string;
  unloadExpectedVersionHash?: string;
  id: string;
  content: string;
  syncCollab: boolean;
  operationSource: string;
  operationRevision: number;
  expectedVersionHash: string;
}

/**
 * A pagehide request must retain its own CAS base. The durable outbox may fold
 * later edits onto the oldest base, but a direct keepalive can race that
 * predecessor and must remain replayable in operation order.
 */
export function prepareFileContentSaveKeepalive(
  pending: FileContentSaveRequest,
): FileContentSaveRequest {
  return pending.unloadExpectedVersionHash === undefined
    ? pending
    : { ...pending, unloadExpectedVersionHash: undefined };
}

export function coalescePendingFileContentSave(
  next: FileContentSaveRequest,
  pending: FileContentSaveRequest | undefined,
): FileContentSaveRequest {
  return pending &&
    !(
      next.identityMigrationSourceContent !== undefined &&
      next.identityMigrationSourceContent !==
        pending.identityMigrationSourceContent
    )
    ? { ...next, expectedVersionHash: pending.expectedVersionHash }
    : next;
}

type FileContentSaveRequestsById = Readonly<
  Record<string, FileContentSaveRequest>
>;

export function shouldClearLatestUnloadSave(
  latest: FileContentSaveRequest | undefined,
  completed: FileContentSaveRequest,
): boolean {
  return Boolean(
    latest &&
    latest.id === completed.id &&
    latest.content === completed.content &&
    latest.syncCollab === completed.syncCollab &&
    latest.operationSource === completed.operationSource &&
    latest.operationRevision === completed.operationRevision,
  );
}

export function advanceLatestUnloadSaveBase(
  latest: FileContentSaveRequest | undefined,
  completed: FileContentSaveRequest,
  persistedVersionHash: string,
): boolean {
  const completedBase =
    completed.unloadExpectedVersionHash ?? completed.expectedVersionHash;
  const latestBase =
    latest?.unloadExpectedVersionHash ?? latest?.expectedVersionHash;
  if (
    !latest ||
    latest === completed ||
    latest.id !== completed.id ||
    latest.operationSource !== completed.operationSource ||
    latest.operationRevision <= completed.operationRevision ||
    latestBase !== completedBase
  ) {
    return false;
  }
  latest.unloadExpectedVersionHash = persistedVersionHash;
  return true;
}

export function shouldClearLatestUnloadSaveForOutboxEntry(
  latest: FileContentSaveRequest | undefined,
  entry: {
    resourceId: string;
    operationSource: string;
    operationRevision: number;
  },
): boolean {
  return Boolean(
    latest &&
    latest.id === entry.resourceId &&
    latest.operationSource === entry.operationSource &&
    latest.operationRevision === entry.operationRevision,
  );
}

export function flushPendingFileContentSavesOnCleanup(
  pendingByFileId: FileContentSaveRequestsById,
  timerIds: readonly number[],
  save: (pending: FileContentSaveRequest) => void,
  clearTimer: (timerId: number) => void,
): void {
  for (const pending of Object.values(pendingByFileId)) save(pending);
  for (const timerId of timerIds) clearTimer(timerId);
}

export function flushFileContentSavesOnBackground(
  pendingByFileId: FileContentSaveRequestsById,
  latestUnacknowledgedByFileId: FileContentSaveRequestsById,
  timerIds: readonly number[],
  save: (pending: FileContentSaveRequest) => unknown | Promise<unknown>,
  clearTimer: (timerId: number) => void,
): Promise<void> {
  const newestByFileId = new Map<string, FileContentSaveRequest>();
  for (const pending of Object.values(latestUnacknowledgedByFileId)) {
    newestByFileId.set(pending.id, pending);
  }
  for (const pending of Object.values(pendingByFileId)) {
    const current = newestByFileId.get(pending.id);
    if (!current || pending.operationRevision >= current.operationRevision) {
      newestByFileId.set(pending.id, pending);
    }
  }
  const saves = [...newestByFileId.values()].map((pending) => {
    try {
      return Promise.resolve(save(pending));
    } catch (error) {
      return Promise.reject(error);
    }
  });
  for (const timerId of timerIds) clearTimer(timerId);
  return Promise.all(saves).then(() => undefined);
}

export function shouldSendKeepalive(
  hashKnown: boolean,
  collabLive: boolean,
): boolean {
  return hashKnown || !collabLive;
}

const EMPTY_DESIGN_FILES: DesignFile[] = [];

export function resolveServerFiles(
  design: { files?: DesignFile[] } | null | undefined,
): DesignFile[] {
  return design?.files ?? EMPTY_DESIGN_FILES;
}

export function shouldRetirePendingLocalFileContent(
  pending: { content: string; baseUpdatedAt?: string | null } | undefined,
  file: { content?: string | null; updatedAt?: string | null },
): boolean {
  if (!pending) return false;
  if ((file.content ?? "") !== pending.content) return false;
  return (
    pending.baseUpdatedAt === undefined ||
    file.updatedAt !== pending.baseUpdatedAt
  );
}
