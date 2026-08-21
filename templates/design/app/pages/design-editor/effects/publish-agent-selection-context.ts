import { setClientAppState } from "@agent-native/core/client/hooks";
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

export interface PublishAgentSelectionContextArgs {
  activeBreakpointWidthState: number | undefined;
  activeCodeFile: CodeWorkbenchActiveFile | null;
  activeFile: DesignFile;
  activeInspectorTab: InspectorTab;
  activeLeftPanel: DesignLeftPanel;
  activeTool: DesignTool;
  design: DesignData | null;
  designDataJson: Record<string, unknown>;
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
    // §8 DesignNavigationState additions — dock + breakpoint context
    dock: { kind: "motion" as const, open: motionDockOpen },
    motion: {
      previewing: false,
      playheadMs: 0,
      timelineId: undefined as string | undefined,
      selectedTrackId: undefined as string | undefined,
      selectedKeyframeId: undefined as string | undefined,
    },
    // §8 breakpoint fields — "auto" = no specific breakpoint focused.
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
    // §8 — active design state (null = Default / live view)
    selectedStateId,
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
    selectedElement: selection.selectedElement,
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
      setClientAppState(key, pending.value, { keepalive: true }).catch(
        () => {},
      );
    }
  };
  if (persistedSelectionStateRef.current === persistedKey) {
    // A zoom gesture can return to the last persisted value before its
    // trailing write fires. Cancel that now-stale queued intermediate.
    if (persistedSelectionWriteTimerRef.current !== null) {
      window.clearTimeout(persistedSelectionWriteTimerRef.current);
      persistedSelectionWriteTimerRef.current = null;
    }
    pendingPersistedSelectionWriteRef.current = null;
  } else if (persistedSelectionContextRef.current !== persistedContextKey) {
    // Screen/selection/tool/panel changes are agent context and stay
    // immediate. Only zoom-only churn is coalesced below.
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
    // Wheel/pinch zoom can render at 60+ Hz. Writing both scoped and global
    // application-state keys for every tick creates an avoidable request +
    // sync-event storm; keep the immediate in-memory context above and
    // persist only the settled zoom after a short trailing delay.
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
