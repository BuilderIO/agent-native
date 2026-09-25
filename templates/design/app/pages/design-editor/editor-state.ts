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

// Definition moved to shared/ so the server write path and code-layer's
// document transforms guard on the same predicate. Re-exported here because
// the editor's URL-backed-screen refusals all import it from this module.
export { isStandaloneHttpUrl };

/**
 * A live-screen route intentionally refuses whole-document replacement. That
 * is a successful no-op, unlike an unavailable preview bridge, which callers
 * must recover by rebuilding their render state.
 */
export type PreviewContentReplaceResult =
  | "applied"
  | "skipped-live-route"
  | "skipped-caller-owns-preview"
  | "unavailable";

/**
 * True when the in-place bridge patch could not run and the caller must fall
 * back to rebuilding srcdoc — a real iframe reload that re-executes the editor
 * bridge, Tailwind and Alpine. Traced because it is the one escalation a user
 * perceives as "the frame refreshed", and it is otherwise invisible.
 */
export function previewContentReplaceNeedsRenderFallback(
  result: PreviewContentReplaceResult,
): boolean {
  if (result !== "unavailable") return false;
  trace("persist", "preview-bridge-unavailable-reload");
  return true;
}

/**
 * Resolve the source payload behind a localhost-backed Design screen.
 *
 * `design_files.content` intentionally stores the route URL, not its HTML.
 * Writing that value to disk would replace an HTML file with the URL string,
 * so HTML write-back is allowed only after the authenticated snapshot has
 * populated the editor's live source model. CSS can use persisted content,
 * but still fails closed if that payload is a URL-backed screen marker.
 */
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

/**
 * Flash-prevention routing for adopting an ALREADY-server-persisted content
 * snapshot into the editor — the "onApplied host-sync" family: shader fill
 * applies (`apply-shader-fill` → onShaderFillApplied), GLSL shader
 * apply/remove/knob commits (GlslShaderPanel's read-source-file →
 * apply-source-edit → onApplied), and component prop edits.
 *
 * These handlers previously passed `refreshPreview: true` for the active
 * file, but in applyLocalContentUpdate that flag means "skip the in-place
 * replace and force a full srcdoc rebuild" — a real iframe reload of the
 * active screen (white flash, lost scroll/Alpine state, and an onload refire
 * that re-runs screen measurement — observed in the wild as the shader-apply
 * flash plus a zoom-badge drift in the same gesture). The patched content is
 * a normal document update, exactly what the bridge's live in-place
 * full-document replace exists for (see applyLocalContentUpdate's
 * "Holistic flash pipeline" comment), so route it through
 * `forcePreviewFullDocument` instead; applyLocalContentUpdate already falls
 * back to the srcdoc rebuild on its own when the live bridge isn't
 * registered for the surface yet.
 *
 * `persist: false` because the server already owns this content — the
 * updatedAt stamp (when present) records it as the acked base for the next
 * guarded update-file save rather than re-queueing a redundant save.
 */
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
  // Keep the shareable navigation mirror aligned with the tool the editor is
  // actually using. `move` is the default and stays implicit so ordinary
  // editor URLs remain compact; every other tool round-trips explicitly.
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
  /**
   * Nest-conversion clobber fix: the freshest same-tick local write for this
   * screen (DesignEditor's `pendingLocalFileContentsRef`), or null. The
   * `fileContentById` map is memoized off React state, so a write made by
   * `applyFileContentUpdate` earlier in the SAME task burst (e.g. the bridge's
   * auto-layout conversion `visual-style-change` that lands right before the
   * nest-drop's `visual-structure-change`) is not visible in it yet — the
   * structure handler would rebase off pre-conversion content and its own
   * write would silently clobber the conversion. Preferring the synchronous
   * pending write mirrors what the active file already gets through
   * `getFreshActiveFileContent`'s latest/lastLocal refs.
   */
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

/**
 * PF12: decide whether a style change from EditPanel (ScrubInput scrub tick /
 * DesignColorPicker drag tick) should skip the expensive source commit
 * (commitVisualStyles / commitStylesToSelectedLayers — projection parse, HTML
 * patch, Yjs write, history entry) and instead only try the cheap live
 * iframe preview.
 *
 * Only a genuine mid-gesture "preview" tick against a single selected element
 * qualifies: `meta` is undefined for every existing call site that never
 * passed gesture metadata (keyboard edits, agent edits, discrete commits),
 * so this returns false for all of them — preserving prior full-commit
 * behavior exactly. Multi-layer-selection edits (`selectedLayerCount > 1`)
 * have no equivalent cheap multi-element preview channel, so those
 * conservatively keep committing on every tick, same as before PF12.
 */
export function shouldSkipVisualStyleCommitForPreview(args: {
  phase?: "preview" | "commit";
  selectedLayerCount: number;
}): boolean {
  return args.phase === "preview" && args.selectedLayerCount <= 1;
}

/**
 * Unit-aware relative-delta application for a per-node multi-select style
 * commit (see commitRelativeStyleDeltaToSelectedLayers). ScrubInput's arrow-
 * key step and the future `relativeDelta` meta both operate on a plain
 * unitless number in the *same numeric domain* the field displays (px count,
 * degree count, raw opacity/line-height number) — the CSS unit suffix is
 * purely a serialization detail added back on here, matching how
 * formatScrubValue/EditPanel already build the CSS string for a single-target
 * commit.
 *
 * Parses the leading numeric portion of `currentValue` (e.g. "12px" -> 12,
 * "45deg" -> 45, "0.5" -> 0.5), adds `delta`, and re-serializes with
 * whatever unit suffix (if any) the ORIGINAL value used — so a per-node
 * relative nudge preserves that node's own unit instead of assuming every
 * selected node shares the same one. Returns `null` when `currentValue`
 * doesn't parse as a leading number (e.g. a keyword like "auto" or "none"),
 * so the caller can skip that node rather than writing garbage.
 */
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
  // Match formatScrubValue's collapse of float noise (e.g. avoid
  // "12.000000000000002px" from repeated float addition) without imposing a
  // fixed precision the property doesn't use.
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
  /** An identity-only migration yields to a newer peer or agent snapshot. */
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
  /**
   * CAS base for the durable latest-content replay. Normal saves keep their
   * per-edit base so the serialized chain remains strict; the outbox needs the
   * oldest unacknowledged base so a pagehide can replay the full snapshot.
   */
  unloadExpectedVersionHash?: string;
  id: string;
  content: string;
  syncCollab: boolean;
  /** Stable browser-tab identity used to order normal and keepalive saves. */
  operationSource: string;
  /** Monotonic per-file sequence allocated when the edit enters the queue. */
  operationRevision: number;
  /** Hash of the source content this edit was computed from. */
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

/**
 * A completed save may retire the unload retry only when it still represents
 * the latest content queued for that file. A newer edit can enter the debounce
 * slot while an older request is in flight and must remain eligible for the
 * pagehide keepalive.
 */
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

/**
 * A completed predecessor advances a newer unload replay from its old CAS
 * base. Mutate the request in place so debounce slots and save chains keep the
 * same request object, then let the caller re-journal its updated payload.
 */
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

/**
 * Flushes debounce slots through the ordinary serialized mutation path during
 * React cleanup (route/design changes). Real document unload is handled by the
 * pagehide keepalive; normal navigation must not fire-and-forget or discard
 * the final edit.
 */
export function flushPendingFileContentSavesOnCleanup(
  pendingByFileId: FileContentSaveRequestsById,
  timerIds: readonly number[],
  save: (pending: FileContentSaveRequest) => void,
  clearTimer: (timerId: number) => void,
): void {
  for (const pending of Object.values(pendingByFileId)) save(pending);
  for (const timerId of timerIds) clearTimer(timerId);
}

/**
 * A desktop app switch keeps the guest page mounted, so neither pagehide nor
 * React cleanup runs. Flush the newest known request per file through the
 * ordinary serialized mutation path and cancel its debounce timer.
 */
export function flushFileContentSavesOnBackground(
  pendingByFileId: FileContentSaveRequestsById,
  latestUnacknowledgedByFileId: FileContentSaveRequestsById,
  timerIds: readonly number[],
  save: (pending: FileContentSaveRequest) => void | Promise<unknown>,
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

/**
 * Pure decision helper (exported for unit testing) for the pagehide/unload
 * keepalive: should it be sent at all?
 *
 * The keepalive posts a full-document `content` write with `keepalive: true`.
 * Its source hash protects it from overwriting edits that were not part of
 * this queued update. Legacy requests without a source hash are skipped while
 * collab is live because they have no safe version to send.
 */
export function shouldSendKeepalive(
  hashKnown: boolean,
  collabLive: boolean,
): boolean {
  return hashKnown || !collabLive;
}

const EMPTY_DESIGN_FILES: DesignFile[] = [];

/**
 * Identity-stable `design.files` read for the editor render body.
 *
 * `design` is null until the `get-design` query resolves, and a literal `??
 * []` there mints a new array on every render of that window. That identity
 * feeds `files` → `proposalFileIds` → the pending-node-rewrite effect, whose
 * empty-files branch commits a fresh `[]` — a passive-effect update that
 * re-renders, remints the array, and re-fires itself until the query lands
 * ("Maximum update depth exceeded" on cold loads). Return the shared empty
 * array so the no-files render is stable.
 */
export function resolveServerFiles(
  design: { files?: DesignFile[] } | null | undefined,
): DesignFile[] {
  return design?.files ?? EMPTY_DESIGN_FILES;
}

/**
 * Pure decision helper (exported for unit testing) for the pending-local-write
 * reconcile: now that `file` arrived from the server, may the editor stop
 * overlaying this file's pending local content and trust the query cache?
 *
 * Matching content alone does not prove the server took the write. Every
 * optimistic writer also mirrors its content into the cached `get-design`
 * payload while deliberately keeping the file's prior server-clock
 * `updatedAt`, so an echo of our own cache write is indistinguishable from an
 * acknowledgement by content. A writer that records `baseUpdatedAt` keeps its
 * overlay until `updatedAt` actually advances; retiring it early leaves the
 * cache as the only carrier of the edit, and a `get-design` response already
 * in flight when the write happened then lands with pre-write content and the
 * edit vanishes until a reload.
 */
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
