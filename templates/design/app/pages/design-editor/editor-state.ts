import {
  type DesignLeftPanel,
  type DesignTool,
  SHOW_DESIGN_CODE_LEFT_PANEL,
} from "./types";

function isStandaloneHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
export function getPersistedContentHostSyncOptions(args: {
  fileId: string;
  activeFileId: string | null | undefined;
  updatedAt?: string;
}): {
  forcePreviewFullDocument: boolean;
  persist: false;
  updatedAt?: string;
} {
  return {
    forcePreviewFullDocument:
      args.activeFileId !== null &&
      args.activeFileId !== undefined &&
      args.fileId === args.activeFileId,
    persist: false,
    updatedAt: args.updatedAt,
  };
}

export function getDesignEditorShareUrl(
  id: string,
  origin: string,
  basePath = "",
) {
  const normalizedBasePath = basePath.replace(/\/+$/, "");
  const pathname = normalizedBasePath
    ? `${normalizedBasePath}/design/${encodeURIComponent(id)}`
    : `/design/${encodeURIComponent(id)}`;
  return new URL(pathname, origin).toString();
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
}) {
  const params = new URLSearchParams(args.currentSearch);
  const leftPanel =
    args.leftPanel === "code" && !SHOW_DESIGN_CODE_LEFT_PANEL
      ? null
      : args.leftPanel;
  params.set("view", args.viewMode);
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
  latestContent?: string | null;
  lastLocalContent?: string | null;
}) {
  return args.latestContent ?? args.lastLocalContent ?? args.activeContent;
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
  | "file-created";

export function getUndoRedoPriorityOrder(
  preferred: UndoRedoOrderKind | undefined,
): UndoRedoOrderKind[] {
  if (preferred === "geometry") return ["geometry", "content", "file-content"];
  if (preferred === "file-content")
    return ["file-content", "content", "geometry"];
  return ["content", "file-content", "geometry"];
}

export interface FileContentSaveRequest {
  id: string;
  content: string;
  syncCollab: boolean;
  /** Stable browser-tab identity used to order normal and keepalive saves. */
  operationSource: string;
  /** Monotonic per-file sequence allocated when the edit enters the queue. */
  operationRevision: number;
  /**
   * Optimistic-concurrency guard forwarded to update-file's
   * `expectedVersionHash` param — the last content hash this client knows
   * the server/collab doc holds for this file. Populated by callers when
   * known (lastAckedFileContentHashRef); omitted when unknown so update-file
   * keeps its legacy unguarded-write behavior.
   */
  expectedVersionHash?: string;
}

/**
 * A completed save may retire the unload retry only when it still represents
 * the latest content queued for that file. A newer edit can enter the debounce
 * slot while an older request is in flight and must remain eligible for the
 * pagehide keepalive.
 */
export function shouldClearLatestUnloadSave(
  latest: FileContentSaveRequest | undefined,
  completed: FileContentSaveRequest,
  skippedStaleMirror = false,
): boolean {
  return Boolean(
    !skippedStaleMirror &&
    latest &&
    latest.id === completed.id &&
    latest.content === completed.content &&
    latest.syncCollab === completed.syncCollab &&
    latest.operationSource === completed.operationSource &&
    latest.operationRevision === completed.operationRevision,
  );
}

/**
 * Flushes debounce slots through the ordinary serialized mutation path during
 * React cleanup (route/design changes). Real document unload is handled by the
 * pagehide keepalive; normal navigation must not fire-and-forget or discard
 * the final edit.
 */
export function flushPendingFileContentSavesOnCleanup(
  pendingByFileId: Readonly<Record<string, FileContentSaveRequest>>,
  timerIds: readonly number[],
  save: (pending: FileContentSaveRequest) => void,
  clearTimer: (timerId: number) => void,
): void {
  for (const pending of Object.values(pendingByFileId)) save(pending);
  for (const timerId of timerIds) clearTimer(timerId);
}

/**
 * Pure decision helper (exported for unit testing) for the pagehide/unload
 * keepalive: should it be sent at all?
 *
 * The keepalive posts a full-document `content` write with `keepalive: true`.
 * Its operation source/revision prevents older same-tab requests from
 * overwriting it, but there is no round trip to recover from a cross-writer
 * hash rejection. When collab is live (this pending save's `syncCollab` is
 * false) and we don't have a known acked hash, skip it: the Yjs document
 * already holds the current content, while an unguarded full replacement
 * could still conflict with a different writer. Every other combination
 * (collab not live, or a hash IS known) sends the versioned keepalive.
 */
export function shouldSendKeepalive(
  hashKnown: boolean,
  collabLive: boolean,
): boolean {
  return hashKnown || !collabLive;
}
