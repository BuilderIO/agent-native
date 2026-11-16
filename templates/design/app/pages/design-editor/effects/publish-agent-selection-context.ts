import {
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import { stripInlineBytes } from "@agent-native/core/shared";
import {
  HUBSPOT_EMAIL_FRAME_TYPE,
  isHubSpotEmailHtml,
} from "@shared/hubspot-email";
import type { LayoutGridById } from "@shared/layout-grid";
import type { MotionPlaybackMode } from "@shared/motion-timeline";
import type { InteractThemeMode } from "@shared/preview-color-scheme";
import {
  storedScreenFrameType,
  type ScreenFrameType,
} from "@shared/screen-frame-type";
import type { RefObject } from "react";

import type { CodeWorkbenchActiveFile } from "@/components/design/code-workbench/CodeWorkbench";
import type { MotionDockLiveState } from "@/components/design/MotionDock";
import type { ElementInfo } from "@/components/design/types";
import type { ResponsiveEditScope } from "@/pages/design-editor/command-types";
import { KEEPALIVE_ACTION_MAX_BYTES } from "@/pages/design-editor/data-operations";
import { DESIGN_SELECTION_ZOOM_SAVE_DELAY_MS } from "@/pages/design-editor/editor-constants";
import { designSelectionStateKeys } from "@/pages/design-editor/editor-helpers";
import type {
  DesignData,
  DesignFile,
  DesignLeftPanel,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export class DesignSelectionPublishError extends Error {
  constructor(
    readonly key: string,
    readonly cause: unknown,
  ) {
    super(`Could not publish the editor selection to "${key}"`);
    this.name = "DesignSelectionPublishError";
  }
}

const AGENT_SELECTION_STYLE_KEYS = [
  "display",
  "position",
  "width",
  "height",
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "textAlign",
  "flexDirection",
  "gap",
  "borderRadius",
  "opacity",
  "objectFit",
] as const;
const MAX_SUMMARY_CLASSES = 40;
const MAX_SUMMARY_CLASS_LENGTH = 200;
const MAX_SUMMARY_TEXT_LENGTH = 200;
const SELECTION_PUBLISH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export interface AgentSelectionScreen {
  id: string;
  filename: string;
  fileType: string;
  frameType: ScreenFrameType | null;
}

export type ScreenFrameTypeCache = Map<
  string,
  { content: string; frameType: ScreenFrameType | null }
>;

// Stored metadata decides. Only a legacy screen with no stored type reads its
// HTML for the meta marker, cached by id and checked against content rather
// than file object or updatedAt: file objects are rebuilt on every source
// change, and an unsaved local edit changes content without moving updatedAt.
export function summarizeAgentSelectionScreens(
  files: readonly DesignFile[],
  designData: unknown,
  cache: ScreenFrameTypeCache,
): AgentSelectionScreen[] {
  const ids = new Set<string>();
  const screens = files.map((file) => {
    const stored = storedScreenFrameType(designData, file.id);
    let frameType: ScreenFrameType | null;
    if (stored !== undefined) {
      frameType = stored === HUBSPOT_EMAIL_FRAME_TYPE ? stored : null;
    } else {
      ids.add(file.id);
      const cached = cache.get(file.id);
      if (cached && cached.content === file.content) {
        frameType = cached.frameType;
      } else {
        frameType = isHubSpotEmailHtml(file.content)
          ? HUBSPOT_EMAIL_FRAME_TYPE
          : null;
        cache.set(file.id, { content: file.content, frameType });
      }
    }
    return {
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
      frameType,
    };
  });
  for (const id of cache.keys()) {
    if (!ids.has(id)) cache.delete(id);
  }
  return screens;
}

// The agent targets an element by these ids; its subtree style snapshot stays
// in the frame, where copy reads it on demand.
function summarizeSelectedElement(element: ElementInfo) {
  const computedStyles: Record<string, string> = {};
  for (const key of AGENT_SELECTION_STYLE_KEYS) {
    const value = element.computedStyles[key];
    if (value) computedStyles[key] = value;
  }
  const text = element.textContent;
  return {
    tagName: element.tagName,
    id: element.id,
    sourceId: element.sourceId,
    selector: element.selector,
    runtimeSelector: element.runtimeSelector,
    runtimeSourceId: element.runtimeSourceId,
    sourceLayerIdentity: element.sourceLayerIdentity,
    pendingNodeId: element.pendingNodeId,
    componentName: element.componentName,
    provenance: element.provenance,
    repeat: element.repeat,
    primitiveKind: element.primitiveKind,
    isGroup: element.isGroup,
    classes: element.classes
      .filter((name) => name.length <= MAX_SUMMARY_CLASS_LENGTH)
      .slice(0, MAX_SUMMARY_CLASSES),
    classCount: element.classes.length,
    textContent: text?.slice(0, MAX_SUMMARY_TEXT_LENGTH),
    textContentTruncated:
      element.textContentTruncated ||
      (text !== undefined && text.length > MAX_SUMMARY_TEXT_LENGTH) ||
      undefined,
    imageSource: element.imageSource,
    boundingRect: element.boundingRect,
    childElementCount: element.childElementCount,
    isFlexContainer: element.isFlexContainer,
    isGridContainer: element.isGridContainer,
    parentDisplay: element.parentDisplay,
    computedStyles,
  };
}

export interface PublishAgentSelectionContextArgs {
  activeBreakpointWidthState: number | undefined;
  activeCodeFile: CodeWorkbenchActiveFile | null;
  activeFile: DesignFile | undefined;
  activeLeftPanel: DesignLeftPanel | null;
  activeTool: DesignTool;
  design: DesignData | null;
  designDataJson: Record<string, unknown>;
  layoutGrids: LayoutGridById;
  designSelectionOwnerIdRef: RefObject<string>;
  hoveredElement: ElementInfo | null;
  id: string | undefined;
  interactDevice: { name: string; width: number; height: number };
  interactTheme: InteractThemeMode;
  isSignedIn: boolean;
  /** Already translated: tells the person to select again, since the agent may not see the selection. */
  selectionPublishFailedLabel: string;
  mode: EditorMode;
  motionAutoKeyframeEnabled: boolean;
  motionDockOpen: boolean;
  motionDockLiveState: MotionDockLiveState;
  motionDurationMs: number;
  motionPlayhead: number;
  motionPlaybackMode: MotionPlaybackMode;
  motionTimelineId: string | null;
  pendingPersistedSelectionWriteRef: RefObject<{
    key: string;
    contextKey: string;
    value: Record<string, unknown>;
  } | null>;
  persistedSelectionContextRef: RefObject<string | null>;
  persistedSelectionStateRef: RefObject<string | null>;
  persistedSelectionWriteTimerRef: RefObject<number | null>;
  responsiveEditScope: ResponsiveEditScope;
  reviewThreadId: string | null;
  screens: readonly AgentSelectionScreen[];
  selectedElement: ElementInfo | null;
  selectedScreenIds: string[];
  selectedStateId: string | null;
  viewMode: "single" | "overview";
  zoom: number;
}

export function runPublishAgentSelectionContext({
  activeBreakpointWidthState,
  activeCodeFile,
  activeFile,
  activeLeftPanel,
  activeTool,
  design,
  designDataJson,
  layoutGrids,
  designSelectionOwnerIdRef,
  hoveredElement,
  id,
  interactDevice,
  interactTheme,
  isSignedIn,
  selectionPublishFailedLabel,
  mode,
  motionAutoKeyframeEnabled,
  motionDockOpen,
  motionDockLiveState,
  motionDurationMs,
  motionPlayhead,
  motionPlaybackMode,
  motionTimelineId,
  pendingPersistedSelectionWriteRef,
  persistedSelectionContextRef,
  persistedSelectionStateRef,
  persistedSelectionWriteTimerRef,
  responsiveEditScope,
  reviewThreadId,
  screens,
  selectedElement,
  selectedScreenIds,
  selectedStateId,
  viewMode,
  zoom,
}: PublishAgentSelectionContextArgs) {
  if (!id || !isSignedIn) return;
  const selection = {
    designId: id,
    designTitle: design?.title ?? null,
    activeFileId: activeFile?.id ?? null,
    activeFilename: activeFile?.filename ?? null,
    activeFrameType: activeFile
      ? (screens.find((screen) => screen.id === activeFile.id)?.frameType ??
        null)
      : null,
    viewMode,
    zoom,
    screens,
    selectedScreenIds,
    selectedElement,
    hoveredElement,
    mode,
    activeTool,
    // Only meaningful while previewing; null elsewhere so a stale default
    // device is never read as the user's choice. The theme is the mode picked
    // (light, dark or system); system means no scheme is forced.
    interact:
      mode === "interact"
        ? { device: interactDevice, theme: interactTheme }
        : null,
    leftPanel: activeLeftPanel,
    // The comment thread open on the canvas or highlighted in the Threads
    // panel; null when none is, so the agent never reads a closed thread.
    reviewThreadId,
    codeWorkspace: {
      open: activeLeftPanel === "code",
      backendKind: activeCodeFile?.backendKind ?? "virtual-inline",
      activePath: activeCodeFile?.path ?? null,
      activeFileId: activeCodeFile?.fileId ?? null,
      dirty: activeCodeFile?.dirty ?? false,
      versionHash: activeCodeFile?.versionHash ?? null,
    },
    dock: { kind: "motion" as const, open: motionDockOpen },
    motion: {
      previewing: motionDockLiveState.previewing,
      playheadMs: Math.round(
        Math.max(0, Math.min(1, motionPlayhead)) * motionDurationMs,
      ),
      durationMs: motionDurationMs,
      timelineId: motionTimelineId,
      playbackMode: motionPlaybackMode,
      autoKeyframe: motionAutoKeyframeEnabled,
      selectedTrackId: motionDockLiveState.selectedTrackId,
      selectedKeyframeId:
        motionDockLiveState.selectedKeyframeIds.length === 1
          ? motionDockLiveState.selectedKeyframeIds[0]
          : null,
      selectedKeyframeIds: motionDockLiveState.selectedKeyframeIds,
      selectedEasingSegment: motionDockLiveState.selectedEasingSegment
        ? {
            trackId: motionDockLiveState.selectedEasingSegment.trackId,
            targetNodeId:
              motionDockLiveState.selectedEasingSegment.targetNodeId,
            property: motionDockLiveState.selectedEasingSegment.property,
            fromT: motionDockLiveState.selectedEasingSegment.fromT,
            toT: motionDockLiveState.selectedEasingSegment.toT,
          }
        : null,
    },
    breakpoint: (activeBreakpointWidthState != null
      ? activeBreakpointWidthState < 500
        ? "mobile"
        : activeBreakpointWidthState < 1024
          ? "tablet"
          : "desktop"
      : "auto") as "auto" | "mobile" | "tablet" | "desktop",
    activeBreakpointId: (() => {
      if (activeBreakpointWidthState == null) return undefined;
      try {
        const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
        if (
          raw &&
          typeof raw === "object" &&
          Array.isArray((raw as Record<string, unknown>).breakpoints)
        ) {
          const bps = (
            raw as { breakpoints: Array<{ id: string; widthPx: number }> }
          ).breakpoints;
          return bps.find((b) => b.widthPx === activeBreakpointWidthState)?.id;
        }
        // coercion-ok: an unreadable breakpointSet means "none configured", which the undefined return already expresses.
      } catch {
        // ignore
      }
      return undefined;
    })(),
    responsiveEditScope,
    breakpointSetId: (() => {
      try {
        const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
        if (raw && typeof raw === "object") {
          return (raw as Record<string, unknown>).id as string | undefined;
        }
        // coercion-ok: an unreadable breakpointSet means "none configured", which the undefined return already expresses.
      } catch {
        // ignore
      }
      return undefined;
    })(),
    selectedStateId,
    layoutGrid: activeFile ? (layoutGrids[activeFile.id] ?? null) : null,
  };
  (window as any).__designSelection = selection;
  const persistedSelection = {
    designId: selection.designId,
    designTitle: selection.designTitle,
    activeFileId: selection.activeFileId,
    activeFilename: selection.activeFilename,
    viewMode: selection.viewMode,
    zoom: selection.zoom,
    screens: selection.screens,
    selectedScreenIds: selection.selectedScreenIds,
    selectedElement: selectedElement
      ? stripInlineBytes(
          summarizeSelectedElement(selectedElement),
          "placeholder",
        )
      : null,
    mode: selection.mode,
    activeTool: selection.activeTool,
    interact: selection.interact,
    leftPanel: selection.leftPanel,
    reviewThreadId: selection.reviewThreadId,
    codeWorkspace: selection.codeWorkspace,
    dock: selection.dock,
    motion: selection.motion,
    breakpoint: selection.breakpoint,
    activeBreakpointId: selection.activeBreakpointId,
    responsiveEditScope: selection.responsiveEditScope,
    breakpointSetId: selection.breakpointSetId,
    selectedStateId: selection.selectedStateId,
    layoutGrid: selection.layoutGrid,
    ownerId: designSelectionOwnerIdRef.current,
  };
  const persistedKey = JSON.stringify(persistedSelection);
  const { zoom: _zoom, ...persistedContext } = persistedSelection;
  const persistedContextKey = JSON.stringify(persistedContext);
  const writePersistedSelection = (
    pending: {
      key: string;
      contextKey: string;
      value: Record<string, unknown>;
    },
    attempt = 0,
  ) => {
    persistedSelectionStateRef.current = pending.key;
    persistedSelectionContextRef.current = pending.contextKey;
    const keys = designSelectionStateKeys();
    const requestSource = getBrowserTabId();
    // Every key's write shares the browser's in-flight keepalive budget.
    const keepalive =
      new TextEncoder().encode(pending.key).length * keys.length <=
      KEEPALIVE_ACTION_MAX_BYTES;
    let failure: DesignSelectionPublishError | undefined;
    void Promise.all(
      keys.map((key) =>
        setClientAppState(key, pending.value, {
          keepalive,
          requestSource,
        }).then(
          () => true,
          (cause: unknown) => {
            failure = new DesignSelectionPublishError(key, cause);
            console.error(failure);
            return false;
          },
        ),
      ),
    ).then((written) => {
      if (
        written.every(Boolean) ||
        persistedSelectionStateRef.current !== pending.key
      ) {
        return;
      }
      persistedSelectionStateRef.current = null;
      persistedSelectionContextRef.current = null;
      if (attempt >= SELECTION_PUBLISH_RETRY_DELAYS_MS.length) {
        reportWriteFailure(failure, { label: selectionPublishFailedLabel });
        return;
      }
      if (persistedSelectionWriteTimerRef.current !== null) return;
      const delay = SELECTION_PUBLISH_RETRY_DELAYS_MS[attempt];
      persistedSelectionWriteTimerRef.current = window.setTimeout(() => {
        persistedSelectionWriteTimerRef.current = null;
        writePersistedSelection(pending, attempt + 1);
      }, delay);
    });
  };
  if (persistedSelectionStateRef.current === persistedKey) {
    if (persistedSelectionWriteTimerRef.current !== null) {
      window.clearTimeout(persistedSelectionWriteTimerRef.current);
      persistedSelectionWriteTimerRef.current = null;
    }
    pendingPersistedSelectionWriteRef.current = null;
  } else if (persistedSelectionContextRef.current !== persistedContextKey) {
    if (persistedSelectionWriteTimerRef.current !== null) {
      window.clearTimeout(persistedSelectionWriteTimerRef.current);
      persistedSelectionWriteTimerRef.current = null;
    }
    pendingPersistedSelectionWriteRef.current = null;
    writePersistedSelection({
      key: persistedKey,
      contextKey: persistedContextKey,
      value: persistedSelection,
    });
  } else if (pendingPersistedSelectionWriteRef.current?.key !== persistedKey) {
    pendingPersistedSelectionWriteRef.current = {
      key: persistedKey,
      contextKey: persistedContextKey,
      value: persistedSelection,
    };
    if (persistedSelectionWriteTimerRef.current !== null) {
      window.clearTimeout(persistedSelectionWriteTimerRef.current);
    }
    persistedSelectionWriteTimerRef.current = window.setTimeout(() => {
      persistedSelectionWriteTimerRef.current = null;
      const pending = pendingPersistedSelectionWriteRef.current;
      pendingPersistedSelectionWriteRef.current = null;
      if (pending) writePersistedSelection(pending);
    }, DESIGN_SELECTION_ZOOM_SAVE_DELAY_MS);
  }
  const el = document.documentElement;
  el.dataset.designId = id;
  if (activeFile?.id) el.dataset.fileId = activeFile.id;
  el.dataset.viewMode = viewMode;
  el.dataset.zoom = String(zoom);
  return () => {
    delete (window as any).__designSelection;
    delete el.dataset.designId;
    delete el.dataset.fileId;
    delete el.dataset.viewMode;
    delete el.dataset.zoom;
  };
}
