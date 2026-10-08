import type { ScrubRelativeExpression } from "@agent-native/toolkit/design-tweaks";
import type { InteractionState } from "@shared/interaction-states";
import type { RefObject } from "react";

import type { CapturedStyleTarget } from "@/components/design/edit-panel/style-change-types";
import type { StyleChangeMeta } from "@/components/design/EditPanel";
import type { ElementInfo } from "@/components/design/types";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";
import { shouldSkipVisualStyleCommitForPreview } from "@/pages/design-editor/editor-state";

import { styleWriteTarget } from "./style-write-target";

export interface StyleChangeArgs {
  canEditLiveScreen?: (screenId: string | null | undefined) => boolean;
  commitInteractionStateStyles: (
    state: InteractionState,
    styles: Record<string, string>,
  ) => boolean;
  commitRelativeStyleDeltaToSelectedLayers: (
    property: string,
    operation: number | ScrubRelativeExpression,
    phase?: StyleChangeMeta["phase"],
  ) => boolean;
  commitStylesToSelectedLayers: (
    styles: Record<string, string>,
    phase?: StyleChangeMeta["phase"],
  ) => boolean;
  commitCapturedStyleTargets: (
    styles: Record<string, string>,
    targets: CapturedStyleTarget[],
    interactionState?: InteractionState,
  ) => void;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
    },
  ) => void;
  handleClearBreakpointOverride: (
    property: string,
    maxWidthPx: number,
  ) => boolean;
  previewInteractionStateStyles: (
    state: InteractionState,
    styles: Record<string, string>,
  ) => void;
  selectedCanvasSelectorCandidates: string[];
  selectedElement: ElementInfo | null;
  selectedScreenStyleChange?: (
    screenId: string,
    selector: string,
    styles: Record<string, string>,
    elementInfo?: ElementInfo,
    metadata?: StyleChangeMeta,
  ) => void;
  selectedLayerTargetsRef: RefObject<SelectedLayerTarget[]>;
  textEditingState: { active: boolean; selector?: string; hasRange?: boolean };
}

export function runStyleChange(
  {
    canEditLiveScreen,
    commitInteractionStateStyles,
    commitRelativeStyleDeltaToSelectedLayers,
    commitStylesToSelectedLayers,
    commitCapturedStyleTargets,
    commitVisualStyles,
    handleClearBreakpointOverride,
    previewInteractionStateStyles,
    selectedCanvasSelectorCandidates,
    selectedElement,
    selectedScreenStyleChange,
    selectedLayerTargetsRef,
    textEditingState,
  }: StyleChangeArgs,
  property: string,
  value: string,
  meta?: StyleChangeMeta,
) {
  const selectedScreenId =
    selectedLayerTargetsRef.current.length <= 1
      ? (selectedLayerTargetsRef.current[0]?.fileId ??
        selectedElement?.sourceLayerIdentity?.screenId)
      : null;
  const selector = selectedElement?.selector ?? "body";
  const target = styleWriteTarget({ selector, selectedElement });
  const capturedLiveTarget =
    meta?.capturedStyleTargets?.length === 1
      ? meta.capturedStyleTargets[0]
      : undefined;
  if (
    capturedLiveTarget &&
    canEditLiveScreen?.(capturedLiveTarget.fileId) &&
    selectedScreenStyleChange
  ) {
    const capturedElement = capturedLiveTarget.elementInfo;
    selectedScreenStyleChange(
      capturedLiveTarget.fileId,
      styleWriteTarget({
        selector: capturedElement.selector ?? "body",
        selectedElement: capturedElement,
      }),
      { [property]: value },
      capturedElement,
      meta,
    );
    return;
  }

  if (meta?.phase === "cancel") {
    if (selectedScreenId && selectedScreenStyleChange) {
      selectedScreenStyleChange(
        selectedScreenId,
        target,
        { [property]: value },
        selectedElement ?? undefined,
        meta,
      );
    }
    commitStylesToSelectedLayers({}, "cancel");
    return;
  }
  if (meta?.capturedStyleTargets && meta.phase !== "preview") {
    commitCapturedStyleTargets(
      { [property]: value },
      meta.capturedStyleTargets,
      meta.interactionState,
    );
    return;
  }
  if (meta?.interactionState) {
    if (selectedScreenId && selectedScreenStyleChange) {
      selectedScreenStyleChange(
        selectedScreenId,
        target,
        { [property]: value },
        selectedElement ?? undefined,
        meta,
      );
      return;
    }
    if (meta.phase === "preview") {
      previewInteractionStateStyles(meta.interactionState, {
        [property]: value,
      });
      return;
    }
    if (
      commitInteractionStateStyles(meta.interactionState, {
        [property]: value,
      })
    ) {
      return;
    }
  }
  if (meta?.breakpointReset) {
    handleClearBreakpointOverride(
      meta.breakpointReset.property,
      meta.breakpointReset.maxWidthPx,
    );
    return;
  }
  if (textEditingState.hasRange && textEditingState.selector === selector) {
    if (selectedScreenId && selectedScreenStyleChange) {
      selectedScreenStyleChange(
        selectedScreenId,
        target,
        { [property]: value },
        selectedElement ?? undefined,
        { ...meta, phase: "preview" },
      );
      return;
    }
    if (!selectedScreenId) {
      const sendStyleChange = (window as any).__designCanvasSendStyle;
      if (typeof sendStyleChange === "function") {
        sendStyleChange(selector, property, value, {
          selectorCandidates: selectedCanvasSelectorCandidates,
          nodeId: selectedElement?.sourceId,
          phase: meta?.phase,
        });
        return;
      }
    }
  }
  if (
    meta?.phase === "preview" &&
    selectedScreenId &&
    selectedScreenStyleChange
  ) {
    selectedScreenStyleChange(
      selectedScreenId,
      target,
      { [property]: value },
      selectedElement ?? undefined,
      meta,
    );
    return;
  }
  if (
    shouldSkipVisualStyleCommitForPreview({
      phase: meta?.phase,
      selectedLayerCount: selectedLayerTargetsRef.current.length,
    })
  ) {
    const sendStyleChange = (window as any).__designCanvasSendStyle;
    if (typeof sendStyleChange === "function") {
      sendStyleChange(target, property, value, {
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement?.sourceId,
      });
    }
    return;
  }
  if (selectedScreenId && selectedScreenStyleChange) {
    selectedScreenStyleChange(
      selectedScreenId,
      target,
      { [property]: value },
      selectedElement ?? undefined,
      meta,
    );
    return;
  }
  if (meta?.relativeExpression) {
    commitRelativeStyleDeltaToSelectedLayers(
      property,
      meta.relativeExpression,
      meta.phase,
    );
    return;
  }
  const relativeDelta = meta?.relativeDelta;
  if (typeof relativeDelta === "number") {
    if (
      commitRelativeStyleDeltaToSelectedLayers(
        property,
        relativeDelta,
        meta?.phase,
      )
    )
      return;
  }
  if (
    selectedElement &&
    commitStylesToSelectedLayers({ [property]: value }, meta?.phase)
  )
    return;
  commitVisualStyles(target, { [property]: value });
}
