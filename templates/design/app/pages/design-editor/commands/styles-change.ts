import type { InteractionState } from "@shared/interaction-states";
import type { RefObject } from "react";

import type { StyleChangeMeta } from "@/components/design/EditPanel";
import type { ElementInfo } from "@/components/design/types";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";
import { shouldSkipVisualStyleCommitForPreview } from "@/pages/design-editor/editor-state";

export interface StylesChangeArgs {
  commitInteractionStateStyles: (
    state: InteractionState,
    styles: Record<string, string>,
  ) => boolean;
  commitRelativeStyleDeltaToSelectedLayers: (
    property: string,
    delta: number,
  ) => boolean;
  commitStylesToSelectedLayers: (styles: Record<string, string>) => boolean;
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
  selectedLayerTargetsRef: RefObject<SelectedLayerTarget[]>;
  textEditingState: { active: boolean; selector?: string; hasRange?: boolean };
}

export function runStylesChange(
  {
    commitInteractionStateStyles,
    commitRelativeStyleDeltaToSelectedLayers,
    commitStylesToSelectedLayers,
    commitVisualStyles,
    handleClearBreakpointOverride,
    previewInteractionStateStyles,
    selectedCanvasSelectorCandidates,
    selectedElement,
    selectedLayerTargetsRef,
    textEditingState,
  }: StylesChangeArgs,
  styles: Record<string, string>,
  meta?: StyleChangeMeta,
) {
  // Interaction-states phase 2 — see handleStyleChange's matching branch
  // (and commitInteractionStateStyles's doc comment) for the full
  // contract. Batched form: every property in this one commit lands in
  // the SAME managed-block write (one applyFileContentUpdate call), so a
  // multi-property commit made while a state is active (e.g. a shadow
  // popover's X/Y/blur/spread) is still exactly one history step.
  if (meta?.interactionState) {
    if (meta.phase === "preview") {
      previewInteractionStateStyles(meta.interactionState, styles);
      return;
    }
    if (commitInteractionStateStyles(meta.interactionState, styles)) {
      return;
    }
  }
  // Item 14 — see handleStyleChange's matching branch for the full
  // breakpointReset contract. EditPanel's BreakpointOverrideIndicator
  // reset currently only fires through onStyleChange (a single
  // property), but StylesChangeHandler shares the same StyleChangeMeta
  // type, so this guards defensively for any batched caller too —
  // breakpointReset only ever targets its own `property`, so only that
  // one key of `styles` is relevant here.
  if (meta?.breakpointReset) {
    handleClearBreakpointOverride(
      meta.breakpointReset.property,
      meta.breakpointReset.maxWidthPx,
    );
    return;
  }
  const selector = selectedElement?.selector ?? "body";
  const entries = Object.entries(styles).filter(([, value]) => Boolean(value));
  if (entries.length === 0) return;
  // T10: mirror handleStyleChange's text-range routing here. Without
  // this, a multi-property style commit (e.g. EditPanel's typography
  // controls, which batch fontSize/lineHeight/etc into one call) while a
  // text RANGE is selected mid-edit would restyle the whole element
  // instead of just the selected range — handleStyleChange (the
  // single-property path) already special-cases this; handleStylesChange
  // just never got the same treatment.
  if (
    textEditingState.active &&
    textEditingState.hasRange &&
    textEditingState.selector === selector
  ) {
    const sendStyleChange = (window as any).__designCanvasSendStyle;
    if (typeof sendStyleChange === "function") {
      entries.forEach(([property, value]) => {
        sendStyleChange(selector, property, value, {
          selectorCandidates: selectedCanvasSelectorCandidates,
          nodeId: selectedElement?.sourceId,
        });
      });
      return;
    }
  }
  // PF12: same preview/commit split as handleStyleChange — see its
  // comment for the full undo-safety rationale. A batched multi-property
  // preview tick (e.g. EditPanel's shadow X/Y/blur/spread popover) is
  // still just a live preview: send every property to the cheap iframe
  // bridge and skip the expensive multi-property commitVisualStyles call.
  if (
    shouldSkipVisualStyleCommitForPreview({
      phase: meta?.phase,
      selectedLayerCount: selectedLayerTargetsRef.current.length,
    })
  ) {
    const sendStyleChange = (window as any).__designCanvasSendStyle;
    if (typeof sendStyleChange === "function") {
      entries.forEach(([property, value]) => {
        sendStyleChange(selector, property, value, {
          selectorCandidates: selectedCanvasSelectorCandidates,
          nodeId: selectedElement?.sourceId,
        });
      });
    }
    return;
  }
  // Mixed-value arrow-step parity (item 7): see handleStyleChange's
  // matching comment for the full defensive-read rationale. A relative
  // delta is inherently single-valued (one scrub gesture on one field),
  // so this only applies when the batched patch has exactly one entry —
  // a multi-property patch (e.g. a shadow popover's X+Y+blur+spread all
  // at once) has no single delta to apply per-node and falls through to
  // the existing absolute-value paths unchanged.
  const relativeDelta = (meta as { relativeDelta?: number } | undefined)
    ?.relativeDelta;
  if (typeof relativeDelta === "number" && entries.length === 1) {
    const [singleProperty] = entries[0]!;
    if (commitRelativeStyleDeltaToSelectedLayers(singleProperty, relativeDelta))
      return;
  }
  if (
    selectedElement &&
    commitStylesToSelectedLayers(Object.fromEntries(entries))
  )
    return;
  commitVisualStyles(selector, Object.fromEntries(entries));
}
