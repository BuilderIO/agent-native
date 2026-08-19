import { buildCodeLayerProjection } from "@shared/code-layer";
import type { InteractionState } from "@shared/interaction-states";
import { normalizeDesignSourceType } from "@shared/source-mode";
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
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
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
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
  handleVisualStyleChange: (
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: { originalStyles?: Record<string, string> },
  ) => void;
  overviewScreens: OverviewScreen[];
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
  metadata?: { originalStyles?: Record<string, string> },
) {
  if (screenId === activeFile?.id) {
    handleVisualStyleChange(selector, styles, elementInfo, metadata);
    return;
  }
  // §gesture-persistence — mirror handleVisualStyleChange's source-type
  // branch for overview screens other than the active one: localhost
  // still queues for agent apply, inline/fusion screens persist the
  // gesture commit immediately (breakpoint-aware, single history step),
  // matching commitStylesToSelectedLayers's established per-file write
  // pattern below.
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType =
    normalizeDesignSourceType(overviewScreen?.sourceType) ?? designSourceType;
  if (screenSourceType === "localhost") {
    recordPendingVisualStyleEdit(
      screenId,
      selector,
      styles,
      elementInfo,
      metadata,
    );
    return;
  }
  if (!canEditDesign) return;
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return;
  const baseContent = getScreenContent(screenId);
  if (!baseContent) return;
  const projection = buildCodeLayerProjection(baseContent);
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
