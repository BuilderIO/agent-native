import type { CodeLayerProjection } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import { assertDesignHtmlEditIntegrity } from "@shared/html-integrity";
import type { InteractionState } from "@shared/interaction-states";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import {
  isShaderWriteInFlight,
  waitForShaderWriteToSettle,
} from "@/components/design/inspector/GlslShaderPanel";
import type { ElementInfo } from "@/components/design/types";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  codeLayerSelectorAliases,
  codeLayerSelectorMatches,
  elementInfoIsRuntimeOnly,
  ensureGoogleFontLinkInHtml,
  isClientRenderedMountShell,
  preferredCodeLayerSelector,
  resolveCodeLayerTargetFromBridge,
  resolveCodeLayerTargetFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type {
  LiveScreenSnapshot,
  PatchProofState,
  ResponsiveEditScope,
} from "@/pages/design-editor/command-types";
import { clearAutoTextColorMarkerOnExplicitColorCommit } from "@/pages/design-editor/cross-screen-text-color";
import {
  LOCAL_EDIT_ORIGIN,
  TAB_ID,
} from "@/pages/design-editor/editor-session";
import type { PreviewContentReplaceResult } from "@/pages/design-editor/editor-state";
import {
  isStandaloneHttpUrl,
  previewContentReplaceNeedsRenderFallback,
  shouldReplacePreviewAfterVisualStyleCommit,
} from "@/pages/design-editor/editor-state";
import type {
  ContentHistoryChange,
  ContentHistoryEntry,
} from "@/pages/design-editor/history";
import {
  applyScopedVisualStyleEdit,
  replayPendingVisualStyleRuntimePatch,
  resolveVisualStyleCommitContent,
} from "@/pages/design-editor/pending-edits";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { applyInlineStylesToHtml } from "@/pages/design-editor/screen-command-utils";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CommitVisualStylesArgs {
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeCodeLayerProjection: CodeLayerProjection;
  activeContent: string;
  activeFile: DesignFile;
  activeProjectionContent: string;
  canEditDesign: boolean;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
    },
  ) => void;
  isSynced: boolean;
  lastDuplicateTransformRef: RefObject<{
    rootNodeIds: string[];
    dx: number;
    dy: number;
  } | null>;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  queueFileContentSave: (
    fileId: string,
    content: string,
    options?: { syncCollab?: boolean; immediate?: boolean },
  ) => void;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  recordLocalContentHistoryChangeFallback: (
    change: ContentHistoryChange,
  ) => void;
  recordLocalContentHistoryEntry: (change: ContentHistoryChange) => void;
  recordPendingVisualStyleEdit: (
    screenId: string,
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: {
      originalStyles?: Record<string, string>;
      interactionState?: InteractionState;
    },
  ) => void;
  replacePreviewContent: (
    nextContent: string,
    selector?: string | null,
    options?: { forceFullDocument?: boolean },
  ) => PreviewContentReplaceResult;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedElement: ElementInfo | null;
  setCollabContent: Dispatch<SetStateAction<string | null>>;
  setCollabContentFileId: Dispatch<SetStateAction<string | null>>;
  setContentRenderRevision: Dispatch<SetStateAction<number>>;
  setPatchProof: Dispatch<SetStateAction<PatchProofState | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  suppressContentHistoryRef: RefObject<boolean>;
  t: (key: string, options?: Record<string, unknown>) => string;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  upsertMotionKeyframesFromStyles: (
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    selector?: string,
  ) => void;
  viewModeRef: RefObject<"single" | "overview">;
  ydoc: Y.Doc | null;
}

export function runCommitVisualStyles(
  {
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef,
    activeCanvasSourceType,
    activeCodeLayerProjection,
    activeContent,
    activeFile,
    activeProjectionContent,
    canEditDesign,
    commitVisualStyles,
    isSynced,
    lastDuplicateTransformRef,
    lastLocalContentRef,
    latestActiveContentRef,
    liveScreenSnapshotsById,
    queueFileContentSave,
    recordContentHistoryEntry,
    recordLocalContentHistoryChangeFallback,
    recordLocalContentHistoryEntry,
    recordPendingVisualStyleEdit,
    replacePreviewContent,
    responsiveEditScopeRef,
    selectedElement,
    setCollabContent,
    setCollabContentFileId,
    setContentRenderRevision,
    setPatchProof,
    setSelectedElement,
    setSelectedLayerIdsState,
    suppressContentHistoryRef,
    t,
    undoManagerRef,
    updateLiveScreenSnapshotContent,
    upsertMotionKeyframesFromStyles,
    viewModeRef,
    ydoc,
  }: CommitVisualStylesArgs,
  selector: string,
  styles: Record<string, string>,
  options: {
    runtimeApplied?: boolean;
    elementInfo?: ElementInfo;
    /** Pre-gesture values, for the pending-edit revert stack. */
    originalStyles?: Record<string, string>;
  } = {},
) {
  trace("persist", "commit-styles", {
    selector: typeof selector === "string" ? selector : null,
    props: Object.keys(styles ?? {}),
  });
  if (!activeFile || !canEditDesign) return;
  // Cross-pipeline write race guard (see GlslShaderPanel.tsx's module doc
  // comment on withShaderWriteLock/waitForShaderWriteToSettle): a shader
  // apply/remove/knob-commit for this same file goes through a completely
  // separate round trip (read-source-file -> apply-source-edit) than this
  // function's own commit, and both eventually rewrite the SAME Y.Doc —
  // one via a server-side diff, this one via a synchronous, untracked
  // full-document ydoc.transact rewrite below. Racing the two produces a
  // corrupted, doubled document (verified). The common case (no shader
  // write in flight for this file) stays fully synchronous — only defer
  // when isShaderWriteInFlight is actually true, so this never adds a
  // microtask tick to the hot path or breaks the same-tick multi-property
  // composition the baseContent comment below depends on.
  if (isShaderWriteInFlight(activeFile.id)) {
    void waitForShaderWriteToSettle(activeFile.id).then(() => {
      commitVisualStyles(selector, styles, options);
    });
    return;
  }
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return;
  upsertMotionKeyframesFromStyles(styles, options.elementInfo, selector);
  // §gesture-persistence — a localhost screen's source of truth is the
  // running app's own files, which this client cannot write. Everything
  // below patches the design's STORED html, which for such a screen is
  // only the bridged route URL, so an inspector commit updated the model
  // and the undo stack while the running app kept rendering the old value
  // and no pending edit was ever queued for the Apply pass. Push the value
  // into the live DOM and queue it, exactly like a canvas gesture
  // (handleVisualStyleChange delegates here with runtimeApplied set
  // because its gesture already moved the live DOM).
  if (activeCanvasSourceType === "localhost") {
    const targetInfo = options.elementInfo ?? selectedElement ?? undefined;
    // Breakpoint-scoped writes are excluded for the same reason as the
    // base path below (Item 5, edit-flash): the agent persists them as a
    // width-scoped class or an `@media` rule, which an inline style would
    // preview wrong.
    if (
      !options.runtimeApplied &&
      activeBreakpointUpperBoundPx == null &&
      typeof (window as any).__designCanvasSendStyleForScreen === "function"
    ) {
      replayPendingVisualStyleRuntimePatch(
        {
          screenId: activeFile.id,
          selector,
          sourceId: targetInfo?.runtimeSourceId ?? targetInfo?.sourceId ?? null,
          styles: Object.fromEntries(entries),
        },
        (window as any).__designCanvasSendStyleForScreen,
      );
    }
    recordPendingVisualStyleEdit(activeFile.id, selector, styles, targetInfo, {
      originalStyles: options.originalStyles,
    });
    return;
  }
  // Base every patch off the freshest known content, not the closed-over
  // render value. Handlers that fire several onStyleChange calls in one
  // synchronous user action (e.g. fixed-size text → width+height+whiteSpace,
  // constraints center → both axes, linked padding → 4 sides) would
  // otherwise each read the same pre-render `activeContent` and clobber one
  // another, so only the last property survived in the saved HTML. Since we
  // advance lastLocalContentRef.current to resolvedNextContent below, the
  // next synchronous call reads the previous call's result and the patches
  // compose. Falls back to activeContent when the ref is unset (file switch).
  const activeLiveSnapshot = activeFile
    ? liveScreenSnapshotsById[activeFile.id]
    : undefined;
  const baseContent =
    activeLiveSnapshot?.html ??
    latestActiveContentRef.current ??
    lastLocalContentRef.current ??
    activeContent;
  // A localhost screen's stored content IS its route URL, so with no
  // snapshot yet the chain above yields that URL string. Projecting it gives
  // a 3-node document where nothing resolves: a snapshot that has not
  // arrived is not an empty document.
  if (isStandaloneHttpUrl(baseContent)) {
    toast.error(t("designEditor.patchProof.snapshotNotLoaded"), {
      duration: 4000,
    });
    return;
  }
  const [firstProperty, firstValue] = entries[0];
  // PF12: reuse the already-built activeCodeLayerProjection when its
  // source content is exactly the content this commit is about to patch
  // (the common case — no pending live snapshot/local-edit divergence).
  // Style commits fire on every slider/color-picker drag tick, so
  // skipping a redundant full-document reparse here matters.
  const projection =
    baseContent === activeProjectionContent
      ? activeCodeLayerProjection
      : buildCodeLayerProjection(baseContent);
  const targetInfo = options.elementInfo ?? selectedElement;
  const targetResolution = targetInfo
    ? resolveCodeLayerTargetFromElementInfo(projection, targetInfo)
    : resolveCodeLayerTargetFromBridge(projection, selector);
  const targetNode =
    targetResolution.status === "resolved" ? targetResolution.node : null;
  const sendStyleChange = (window as any).__designCanvasSendStyle;
  // Item 5 (edit-flash): a breakpoint-scoped commit
  // (activeBreakpointUpperBoundPx set) never persists as a plain inline
  // style — planBreakpointStyleWrite below turns it into a width-scoped
  // Tailwind class or an `@media` rule in the managed breakpoints <style>
  // block. sendStyleChange only knows how to patch the live element's
  // INLINE style, which unconditionally beats any `@media` rule's
  // specificity. Applying it here would preview the wrong
  // (inline-style-overridden) value immediately, then visibly flash to the
  // correct cascaded value once the next full document patch/reload catches
  // up — so skip the runtime shortcut entirely for breakpoint-scoped writes
  // and fall through to the full content patch path below, which reflects
  // the actual persisted class/`@media` result.
  const runtimeStyleApplied =
    !options.runtimeApplied &&
    activeBreakpointUpperBoundPx == null &&
    typeof sendStyleChange === "function";
  // Shared by both terminal paths below so neither drifts into previewing a
  // different element than the other.
  const sendRuntimeStylePreview = (): void => {
    if (!runtimeStyleApplied) return;
    // A stamped id goes stale the moment React re-creates the node, so send
    // the bridge-minted identities as fallbacks (see
    // canonicalElementInfoForCodeLayerNode).
    const selectorCandidates = targetNode
      ? codeLayerSelectorAliases(targetNode)
      : Array.from(
          new Set(
            [
              selector,
              targetInfo?.runtimeSelector,
              targetInfo?.selector,
            ].filter((candidate): candidate is string => Boolean(candidate)),
          ),
        );
    const nodeId = targetNode
      ? bridgeSourceIdForCodeLayerNode(targetNode)
      : (targetInfo?.runtimeSourceId ?? targetInfo?.sourceId);
    entries.forEach(([property, value]) => {
      sendStyleChange(selector, property, value, {
        selectorCandidates,
        nodeId,
      });
    });
  };

  // U7: if this style commit repositions (left/top) the node(s) most
  // recently created by Cmd+D, record the delta so the next Cmd+D on that
  // same selection can replay it instead of landing back in place.
  if (targetNode && lastDuplicateTransformRef.current) {
    const nodeId =
      targetNode.dataAttributes["data-agent-native-node-id"] ?? targetNode.id;
    if (lastDuplicateTransformRef.current.rootNodeIds.includes(nodeId)) {
      const nextLeft = parseFloat(styles.left ?? "");
      const nextTop = parseFloat(styles.top ?? "");
      const prevLeft = parseFloat(targetNode.style.left ?? "");
      const prevTop = parseFloat(targetNode.style.top ?? "");
      if (
        Number.isFinite(nextLeft) &&
        Number.isFinite(nextTop) &&
        Number.isFinite(prevLeft) &&
        Number.isFinite(prevTop)
      ) {
        lastDuplicateTransformRef.current = {
          ...lastDuplicateTransformRef.current,
          dx: nextLeft - prevLeft,
          dy: nextTop - prevTop,
        };
      }
    }
  }
  const capability =
    selectedElement?.editCapabilities?.find((item) =>
      item.kind.startsWith("deterministic"),
    ) ?? selectedElement?.editCapabilities?.[0];
  const proofId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (!targetNode && elementInfoIsRuntimeOnly(targetInfo)) {
    // Fail LOUD (same contract as the resolveVisualStyleCommitContent
    // error branch below): patch-proof state alone is too quiet for a
    // user-initiated edit that will never persist.
    //
    // Three facts, three remedies: ambiguous needs scoping, a mount shell
    // has no app markup at ANY selector, and only an authored document that
    // lost the node is actually "missing".
    const resolutionFailure =
      targetResolution.status === "ambiguous"
        ? t("designEditor.patchProof.selectorAmbiguous", {
            count: targetResolution.candidates.length,
          })
        : isClientRenderedMountShell(projection)
          ? t("designEditor.patchProof.clientRenderedShell")
          : t("designEditor.patchProof.selectorMissing");
    toast.error(resolutionFailure, {
      duration: 4000,
    });
    setPatchProof({
      id: proofId,
      fileId: activeFile.id,
      filename: activeFile.filename,
      selector,
      sourceId: targetInfo?.sourceId,
      property:
        entries.length === 1
          ? firstProperty
          : entries.map(([property]) => property).join(", "),
      previousValue: targetInfo?.computedStyles?.[firstProperty],
      nextValue:
        entries.length === 1
          ? firstValue
          : entries
              .map(([property, value]) => `${property}: ${value}`)
              .join("; "),
      previousContent: baseContent,
      capability: "unsupported",
      confidence: 0.3,
      status: "failed",
      error: resolutionFailure,
      createdAt: Date.now(),
    });
    return;
  }
  setPatchProof({
    id: proofId,
    fileId: activeFile.id,
    filename: activeFile.filename,
    selector,
    sourceId: selectedElement?.sourceId,
    property:
      entries.length === 1
        ? firstProperty
        : entries.map(([property]) => property).join(", "),
    previousValue: selectedElement?.computedStyles?.[firstProperty],
    nextValue:
      entries.length === 1
        ? firstValue
        : entries
            .map(([property, value]) => `${property}: ${value}`)
            .join("; "),
    previousContent: baseContent,
    capability: capability?.kind ?? "deterministic-style-edit",
    confidence: capability?.confidence ?? 0.92,
    status: "runtime",
    createdAt: Date.now(),
  });
  sendRuntimeStylePreview();

  const nextContent = applyInlineStylesToHtml(baseContent, selector, {
    ...Object.fromEntries(entries),
  });
  // §6.4 — Breakpoint-scoped editing (Framer cascade). Reuses the
  // `projection` and `targetNode` resolved above for the patch-proof
  // block (same baseContent). When a non-base breakpoint frame is
  // active, EVERY property routes through the single class-vs-media
  // decision (planBreakpointStyleWrite):
  //
  // - Tailwind-utility values become width-scoped responsive classes
  //   (`max-[<bound>px]:text-lg`), replacing any same-stem token at the
  //   same bound.
  // guard:allow-raw-color - prose naming CSS value kinds, not a color literal
  // - Raw CSS values (exact px from drags, rgb()/calc(), …) become
  //   managed `@media (max-width: <bound>px)` rules in the
  //   `<style data-agent-native-breakpoints>` block, targeting the
  //   element's stable node id.
  //
  // Base edits (no active breakpoint, or the active frame is the widest
  // context) keep the plain inline-style path and cascade down to every
  // narrower breakpoint unless overridden there.
  const stylePatch = entries.reduce<{
    content: string;
    failed: string | null;
  }>(
    (current, [property, value]) => {
      if (current.failed) return current;
      const patch = applyScopedVisualStyleEdit({
        content: current.content,
        target: targetNode ? { nodeId: targetNode.id } : { selector },
        property,
        value,
        upperBoundPx: activeBreakpointUpperBoundPx,
        lowerBoundPx:
          responsiveEditScopeRef.current === "only"
            ? activeBreakpointWidthStateRef.current
            : null,
      });
      if (patch.result.status !== "applied") {
        return {
          content: current.content,
          failed: codeLayerPatchMessage(
            patch.result.message,
            t("designEditor.patchProof.selectorMissing"),
          ),
        };
      }
      return { content: patch.content, failed: null };
    },
    { content: baseContent, failed: null },
  );
  // §6.4 — the legacy selector-based inline-style fallback (nextContent)
  // is a BASE write: safe when editing the base, but while a narrower
  // breakpoint is active it would clobber every viewport width with a
  // value the user meant to scope. Fail loud (patch-proof error) instead
  // of silently widening the edit.
  const commitResolution = resolveVisualStyleCommitContent({
    scopedContent: stylePatch.content,
    scopedFailure: stylePatch.failed,
    legacyFallbackContent: nextContent,
    breakpointScoped: activeBreakpointUpperBoundPx != null,
  });
  if ("error" in commitResolution) {
    const failureMessage = codeLayerPatchMessage(
      commitResolution.error,
      t("designEditor.patchProof.selectorMissing"),
    );
    // Fail LOUD, never silently: an unresolvable commit target (e.g. an
    // Alpine template-instance element with no per-instance source node)
    // used to only flip the patch-proof panel to "failed" — no toast, no
    // revert, while the inspector kept displaying the new value, so users
    // had no idea their edit never persisted (verified on real content:
    // Gap scrub on an x-for todo-card subtask row). Same toast pattern as
    // handleVisualStructureChange's move failure.
    toast.error(failureMessage, { duration: 4000 });
    setPatchProof((prev) =>
      prev?.id === proofId
        ? { ...prev, status: "failed", error: failureMessage }
        : prev,
    );
    return;
  }
  const resolvedNextContentBeforeFontLink = commitResolution.content;

  // T16: if this commit set fontFamily to a known Google Font not
  // already loaded in this screen, inject its <link> into <head>.
  const fontFamilyValue = Object.fromEntries(entries).fontFamily;
  const resolvedNextContentAfterFontLink = fontFamilyValue
    ? ensureGoogleFontLinkInHtml(
        resolvedNextContentBeforeFontLink,
        fontFamilyValue,
      )
    : resolvedNextContentBeforeFontLink;

  // Finding 2(b): an explicit "color" commit on a node that still carries
  // BOARD_TEXT_AUTO_COLOR_MARKER means the user just deliberately chose a
  // color — the marker no longer describes an auto-applied default and
  // must not survive to mislead a later reparent/cross-screen move (see
  // isStaleAutoTextColorMarker / clearAutoTextColorMarkerOnExplicitColorCommit).
  const committedNodeId =
    targetNode?.dataAttributes["data-agent-native-node-id"];
  const resolvedNextContent =
    "color" in Object.fromEntries(entries) && committedNodeId
      ? clearAutoTextColorMarkerOnExplicitColorCommit(
          resolvedNextContentAfterFontLink,
          committedNodeId,
        )
      : resolvedNextContentAfterFontLink;

  try {
    assertDesignHtmlEditIntegrity({
      previousContent: baseContent,
      nextContent: resolvedNextContent,
      fileType: activeFile.fileType,
    });
  } catch (error) {
    const message = designSaveErrorMessage(error) ?? t("common.genericError");
    toast.error(message, {
      id: `design-source-integrity:${activeFile.id}`,
    });
    setPatchProof((previous) =>
      previous?.id === proofId
        ? { ...previous, status: "failed", error: message }
        : previous,
    );
    return;
  }

  const nextProjection = buildCodeLayerProjection(resolvedNextContent);
  const resolvedNode = selectedElement
    ? nextProjection.nodes.find((node) => {
        const aliases = codeLayerSelectorAliases(node);
        return (
          (selectedElement.sourceId &&
            (node.id === selectedElement.sourceId ||
              node.dataAttributes["data-agent-native-node-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-code-layer-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-layer-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-builder-id"] ===
                selectedElement.sourceId ||
              node.dataAttributes["data-loc"] === selectedElement.sourceId ||
              node.attributes.id === selectedElement.sourceId)) ||
          aliases.includes(selector) ||
          codeLayerSelectorMatches(node, selector)
        );
      })
    : null;
  const liveSnapshotUpdated = activeLiveSnapshot
    ? updateLiveScreenSnapshotContent(activeFile.id, resolvedNextContent)
    : false;
  if (liveSnapshotUpdated) {
    setPatchProof((prev) =>
      prev?.id === proofId ? { ...prev, status: "queued" } : prev,
    );
    if (!runtimeStyleApplied) {
      setContentRenderRevision((revision) => revision + 1);
    }
  } else {
    const yjsHistoryAvailable = Boolean(
      viewModeRef.current !== "overview" &&
      ydoc &&
      isSynced &&
      undoManagerRef.current,
    );
    if (
      !yjsHistoryAvailable &&
      !suppressContentHistoryRef.current &&
      baseContent !== resolvedNextContent
    ) {
      const change = {
        fileId: activeFile.id,
        before: baseContent,
        after: resolvedNextContent,
      };
      if (viewModeRef.current === "overview") {
        recordContentHistoryEntry(change);
      } else {
        recordLocalContentHistoryEntry(change);
      }
    } else if (
      yjsHistoryAvailable &&
      !suppressContentHistoryRef.current &&
      baseContent !== resolvedNextContent
    ) {
      // BUG-UNDO-RESIZE-STACK: mirror the same before/after into the local
      // fallback stack that applyLocalContentUpdate already maintains for
      // every other commit path (text edits, moves, structure changes).
      // The Yjs UndoManager is destroyed and recreated whenever `docId`
      // changes — a view-mode switch, a zoom-triggered re-render, or a
      // breakpoint switch — which silently drops its entire undo stack.
      // Without this mirror, a gesture-driven style/resize commit (the
      // ONLY commit path that skipped this call) became permanently
      // unrecoverable the moment that happened: handleUndo's um.canUndo()
      // goes false with nothing to fall back to, so Cmd+Z does nothing at
      // all for a resize-drag even though every other edit kind still has
      // a working fallback. Only consulted once Yjs itself has nothing
      // left to undo (see handleUndo), so this never causes a double-undo.
      recordLocalContentHistoryChangeFallback({
        fileId: activeFile.id,
        before: baseContent,
        after: resolvedNextContent,
      });
    }

    setCollabContent(resolvedNextContent);
    setCollabContentFileId(activeFile.id);
    setPatchProof((prev) =>
      prev?.id === proofId ? { ...prev, status: "queued" } : prev,
    );
    // Mark as our own write so the get-design reconcile + Yjs observe don't
    // treat the echo as an external edit and fight the live value.
    lastLocalContentRef.current = resolvedNextContent;
    latestActiveContentRef.current = resolvedNextContent;
    // Write the edit into the shared Y.Doc so other open clients see it live
    // through Yjs (not only via the slower update-file → applyText round-trip).
    // Single-screen edits use the active-file UndoManager. Overview edits are
    // tracked in the global file-content stack so all screens share one order.
    if (ydoc && isSynced) {
      const ytext = ydoc.getText("content");
      if (ytext.toString() !== resolvedNextContent) {
        if (!yjsHistoryAvailable) {
          // Untracked full rewrite (overview mode with a still-live
          // single-mode UndoManager, or history-suppressed replay) —
          // see U1 note: clear the undo stack so a stale tracked delta
          // can't be replayed against content it no longer matches.
          undoManagerRef.current?.clear(true, false);
        }
        ydoc.transact(
          () => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, resolvedNextContent);
          },
          yjsHistoryAvailable ? LOCAL_EDIT_ORIGIN : TAB_ID,
        );
      }
    }
    queueFileContentSave(activeFile.id, resolvedNextContent, {
      syncCollab: !(ydoc && isSynced),
    });
    if (
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: options.runtimeApplied,
        runtimeStyleApplied,
      }) &&
      previewContentReplaceNeedsRenderFallback(
        replacePreviewContent(resolvedNextContent, selector),
      )
    ) {
      setContentRenderRevision((revision) => revision + 1);
    }
  }
  if (resolvedNode) setSelectedLayerIdsState([resolvedNode.id]);
  setSelectedElement((prev) => {
    if (options.elementInfo) return options.elementInfo;
    if (!prev) return prev;
    const stablePatch = resolvedNode
      ? {
          sourceId: bridgeSourceIdForCodeLayerNode(resolvedNode),
          selector: preferredCodeLayerSelector(resolvedNode),
          classes: resolvedNode.classes,
        }
      : {};
    return {
      ...prev,
      ...stablePatch,
      computedStyles: {
        ...prev.computedStyles,
        ...Object.fromEntries(entries),
      },
    };
  });
}
