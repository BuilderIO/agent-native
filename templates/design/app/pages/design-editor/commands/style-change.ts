import type { InteractionState } from "@shared/interaction-states";
import type { RefObject } from "react";

import type { StyleChangeMeta } from "@/components/design/EditPanel";
import type { ElementInfo } from "@/components/design/types";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";
import { shouldSkipVisualStyleCommitForPreview } from "@/pages/design-editor/editor-state";

export interface StyleChangeArgs {
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

export function runStyleChange(
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
  }: StyleChangeArgs,
  property: string,
  value: string,
  meta?: StyleChangeMeta,
) {
  if (meta?.interactionState) {
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
  const selector = selectedElement?.selector ?? "body";
  if (
    textEditingState.active &&
    textEditingState.hasRange &&
    textEditingState.selector === selector
  ) {
    const sendStyleChange = (window as any).__designCanvasSendStyle;
    if (typeof sendStyleChange === "function") {
      sendStyleChange(selector, property, value, {
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement?.sourceId,
      });
      return;
    }
  }
  // PF12: a mid-gesture scrub/color-drag preview tick (ScrubInput's
  // `phase: "preview"`, DesignColorPicker's per-tick `onChange`) is cheap
  // to show live but must NOT run the expensive source commit
  // (projection parse + HTML patch + history entry) on every tick — only
  // the gesture's final "commit" (or a caller that never passes meta at
  // all, e.g. keyboard/agent edits) does that. Route preview ticks
  // through the same cheap iframe postMessage path the text-range case
  // above already uses, and skip commitVisualStyles entirely so there is
  // no source write — and therefore no history entry — for any preview
  // tick. Multi-layer-selection commits (commitStylesToSelectedLayers)
  // have no equivalent cheap multi-element preview channel, so previews
  // for that case conservatively fall through to the existing full-commit
  // behavior below (unchanged from before PF12).
  if (
    shouldSkipVisualStyleCommitForPreview({
      phase: meta?.phase,
      selectedLayerCount: selectedLayerTargetsRef.current.length,
    })
  ) {
    const sendStyleChange = (window as any).__designCanvasSendStyle;
    if (typeof sendStyleChange === "function") {
      sendStyleChange(selector, property, value, {
        selectorCandidates: selectedCanvasSelectorCandidates,
        nodeId: selectedElement?.sourceId,
      });
    }
    // No live bridge available for this preview tick (e.g. inactive
    // screen) — nothing cheap to do; wait for the gesture's "commit".
    return;
  }
  // Mixed-value arrow-step parity (item 7): ScrubInput's own
  // ScrubInputChangeMeta now carries `relativeDelta` (set on a mixed-
  // selection arrow nudge), and EditPanel forwards that meta object
  // straight through to onStyleChange — but StyleChangeMeta (this
  // parameter's declared type) doesn't declare the field yet, so it's
  // read defensively through a local cast rather than a direct property
  // access. This works today (the field is present on the actual object
  // at runtime) and degrades safely to "absent" if that ever changes —
  // either way behavior falls through to the existing absolute-value
  // paths below unchanged. Only routes through the per-node relative
  // path for an actual multi-selection; commitRelativeStyleDeltaToSelectedLayers
  // itself also no-ops (returns false) for a single target.
  const relativeDelta = (meta as { relativeDelta?: number } | undefined)
    ?.relativeDelta;
  if (typeof relativeDelta === "number") {
    if (commitRelativeStyleDeltaToSelectedLayers(property, relativeDelta))
      return;
  }
  // Page properties render only when there is no concrete DOM element
  // selection. Screen/layer ids can remain in the broader selection ref
  // while Escape exposes Page (especially after overview/breakpoint
  // navigation); never let that stale structural selection hijack a page
  // background/font edit away from the body.
  if (selectedElement && commitStylesToSelectedLayers({ [property]: value }))
    return;
  commitVisualStyles(selector, { [property]: value });
}
