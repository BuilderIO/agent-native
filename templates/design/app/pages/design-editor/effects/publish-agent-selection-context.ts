import { setClientAppState } from "@agent-native/core/client/hooks";
import type { LayoutGridById } from "@shared/layout-grid";
import type { RefObject } from "react";

import type { CodeWorkbenchActiveFile } from "@/components/design/code-workbench/CodeWorkbench";
import type { InspectorTab } from "@/components/design/EditPanel";
import type { ElementInfo } from "@/components/design/types";
import type { ResponsiveEditScope } from "@/pages/design-editor/command-types";
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
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "textAlign",
  "flexDirection",
  "gap",
  "borderRadius",
  "opacity",
] as const;
const MAX_SUMMARY_CLASSES = 40;
const MAX_SUMMARY_CLASS_LENGTH = 200;
const MAX_SUMMARY_TEXT_LENGTH = 200;

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
  activeInspectorTab: InspectorTab;
  activeLeftPanel: DesignLeftPanel | null;
  activeTool: DesignTool;
  design: DesignData | null;
  designDataJson: Record<string, unknown>;
  layoutGrids: LayoutGridById;
  designSelectionOwnerIdRef: RefObject<string>;
  files: DesignFile[];
  hoveredElement: ElementInfo | null;
  id: string | undefined;
  isSignedIn: boolean;
  mode: EditorMode;
  motionDockOpen: boolean;
  pendingPersistedSelectionWriteRef: RefObject<{
    key: string;
    contextKey: string;
    value: Record<string, unknown>;
  } | null>;
  persistedSelectionContextRef: RefObject<string | null>;
  persistedSelectionStateRef: RefObject<string | null>;
  persistedSelectionWriteTimerRef: RefObject<number | null>;
  responsiveEditScope: ResponsiveEditScope;
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
  activeInspectorTab,
  activeLeftPanel,
  activeTool,
  design,
  designDataJson,
  layoutGrids,
  designSelectionOwnerIdRef,
  files,
  hoveredElement,
  id,
  isSignedIn,
  mode,
  motionDockOpen,
  pendingPersistedSelectionWriteRef,
  persistedSelectionContextRef,
  persistedSelectionStateRef,
  persistedSelectionWriteTimerRef,
  responsiveEditScope,
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
    viewMode,
    zoom,
    screens: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
    })),
    selectedScreenIds,
    selectedElement,
    hoveredElement,
    mode,
    activeTool,
    inspectorTab: activeInspectorTab,
    leftPanel: activeLeftPanel,
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
      previewing: false,
      playheadMs: 0,
      timelineId: undefined as string | undefined,
      selectedTrackId: undefined as string | undefined,
      selectedKeyframeId: undefined as string | undefined,
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
      ? summarizeSelectedElement(selectedElement)
      : null,
    mode: selection.mode,
    activeTool: selection.activeTool,
    inspectorTab: selection.inspectorTab,
    leftPanel: selection.leftPanel,
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
  const writePersistedSelection = (pending: {
    key: string;
    contextKey: string;
    value: Record<string, unknown>;
  }) => {
    persistedSelectionStateRef.current = pending.key;
    persistedSelectionContextRef.current = pending.contextKey;
    for (const key of designSelectionStateKeys()) {
      setClientAppState(key, pending.value).catch((cause: unknown) => {
        if (persistedSelectionStateRef.current === pending.key) {
          persistedSelectionStateRef.current = null;
          persistedSelectionContextRef.current = null;
        }
        console.error(new DesignSelectionPublishError(key, cause));
      });
    }
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
