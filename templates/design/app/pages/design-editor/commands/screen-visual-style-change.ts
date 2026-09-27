import { buildCodeLayerProjection } from "@shared/code-layer";
import type { InteractionState } from "@shared/interaction-states";
import type { RefObject } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { ResponsiveEditScope } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  applyScopedVisualStyleEdit,
  resolveOverviewScreenSourceType,
  type PendingRelativeStyleOperation,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ScreenVisualStyleChangeArgs {
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  canEditLiveScreen?: (screenId: string) => boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
  handleVisualStyleChange: (
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: {
      originalStyles?: Record<string, string>;
      preserveSelection?: boolean;
      routePath?: string;
      relativeOperations?: Record<string, PendingRelativeStyleOperation>;
      runtimeApplied?: boolean;
    },
  ) => void;
  overviewScreens: OverviewScreen[];
  recordPendingVisualStyleEdit: (
    screenId: string,
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: {
      originalStyles?: Record<string, string>;
      preserveSelection?: boolean;
      interactionState?: InteractionState;
      routePath?: string;
      relativeOperations?: Record<string, PendingRelativeStyleOperation>;
    },
  ) => void;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualStyleChange(
  {
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef,
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    designSourceType,
    getScreenContent,
    handleVisualStyleChange,
    overviewScreens,
    recordPendingVisualStyleEdit,
    responsiveEditScopeRef,
    t,
  }: ScreenVisualStyleChangeArgs,
  screenId: string,
  selector: string,
  styles: Record<string, string>,
  elementInfo?: ElementInfo,
  metadata?: {
    phase?: "preview" | "commit";
    originalStyles?: Record<string, string>;
    preserveSelection?: boolean;
    routePath?: string;
    runtimeApplied?: boolean;
    relativeOperations?: Record<string, PendingRelativeStyleOperation>;
  },
) {
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType = resolveOverviewScreenSourceType(
    overviewScreen,
    designSourceType,
  );
  const canEditScreen =
    canEditDesign ||
    (screenSourceType === "localhost" && canEditLiveScreen?.(screenId));
  if (screenId === activeFile?.id) {
    if (!canEditScreen) return;
    handleVisualStyleChange(selector, styles, elementInfo, metadata);
    return;
  }
  // Overview iframes already paint preview edits locally. Persisting their
  // preview packets here makes every non-active screen write on every drag
  // tick; only the pointer-up commit belongs in the source document.
  if (metadata?.phase === "preview") return;
  // §gesture-persistence — mirror handleVisualStyleChange's source-type
  // branch for overview screens other than the active one: localhost
  // still queues for agent apply, inline/fusion screens persist the
  // gesture commit immediately (breakpoint-aware, single history step),
  // matching commitStylesToSelectedLayers's established per-file write
  // pattern below.
  if (screenSourceType === "localhost") {
    if (!canEditScreen) return;
    recordPendingVisualStyleEdit(screenId, selector, styles, elementInfo, {
      originalStyles: metadata?.originalStyles,
      preserveSelection: metadata?.preserveSelection,
      routePath: metadata?.routePath,
      relativeOperations: metadata?.relativeOperations,
    });
    return;
  }
  if (!canEditDesign) return;
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return;
  const baseContent = getScreenContent(screenId);
  if (!baseContent) return;
  const source = { kind: "design-file" as const, fileId: screenId };
  const projection = buildCodeLayerProjection(baseContent, { source });
  const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
  const targetNode = targetInfo
    ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
    : resolveCodeLayerNodeFromBridge(projection, selector);
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
        source,
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
  if (stylePatch.failed || stylePatch.content === baseContent) return;
  applyFileContentUpdate(screenId, stylePatch.content, {
    skipPreview: true,
  });
}
