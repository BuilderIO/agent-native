import {
  removeAgentChatContextItem,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import type { CodeLayerNode } from "@shared/code-layer";
import type { RefObject } from "react";

import type { ElementInfo } from "@/components/design/types";
import { nodeRepromptSubtreeExcerpt } from "@/lib/node-reprompt";
import { structuralReferenceDirectives } from "@/pages/design-editor/generation-prompt-directives";
import {
  getSelectionIdentity,
  getSelectionShortLabel,
  referenceModeJustArmedForSelection,
} from "@/pages/design-editor/reference-mode";
import { shouldMirrorSelectedElementToAgentChat } from "@/pages/design-editor/selection-state";
import type { DesignData, DesignFile } from "@/pages/design-editor/types";

export interface MirrorSelectionToAgentChatArgs {
  activeFile: DesignFile;
  activeProjectionContent: string;
  composerContextHasOurKeyRef: RefObject<boolean>;
  design: DesignData | null;
  id: string | undefined;
  isSignedIn: boolean;
  mirroredSelectionIdRef: RefObject<string | null>;
  /** True while the current selection is tagged as a reference for this generation turn. */
  referenceActive: boolean;
  previousReferenceActiveRef: RefObject<boolean>;
  selectedCodeLayerNode: CodeLayerNode | null;
  selectedElement: ElementInfo | null;
  sentSelectionIdRef: RefObject<string | null>;
}

export function runMirrorSelectionToAgentChat({
  activeFile,
  activeProjectionContent,
  composerContextHasOurKeyRef,
  design,
  id,
  isSignedIn,
  mirroredSelectionIdRef,
  referenceActive,
  previousReferenceActiveRef,
  selectedCodeLayerNode,
  selectedElement,
  sentSelectionIdRef,
}: MirrorSelectionToAgentChatArgs) {
  const key = "design:selected-element";
  if (!isSignedIn) return;
  if (!id || !shouldMirrorSelectedElementToAgentChat(selectedElement)) {
    mirroredSelectionIdRef.current = null;
    sentSelectionIdRef.current = null;
    previousReferenceActiveRef.current = false;
    removeAgentChatContextItem(key);
    return;
  }

  const selectionId = getSelectionIdentity(activeFile?.id, selectedElement)!;
  // Toggling reference mode on the SAME selection must republish with the
  // new framing even though the selection itself didn't change — otherwise
  // the "same selection, nothing to do" branch below (there to prevent a
  // republish feedback loop while an agent run polls get-design) would also
  // swallow the plain-to-reference transition.
  const referenceJustArmed = referenceModeJustArmedForSelection({
    referenceActive,
    previousReferenceActive: previousReferenceActiveRef.current,
    selectionId,
    previousSelectionId: mirroredSelectionIdRef.current,
  });
  previousReferenceActiveRef.current = referenceActive;
  if (selectionId !== mirroredSelectionIdRef.current || referenceJustArmed) {
    // A genuinely new/changed selection (or a fresh reference tag on the
    // current one) always (re)attaches, regardless of whether the previous
    // state was marked sent.
    sentSelectionIdRef.current = null;
  } else if (
    sentSelectionIdRef.current === selectionId ||
    !composerContextHasOurKeyRef.current
  ) {
    // Same selection as before, and either it was already marked sent, or
    // the shared store no longer carries our key (a send just cleared it,
    // observed by the bookkeeping effect below) — stay cleared. Critically:
    // do nothing else here, so this branch never calls
    // setAgentChatContextItem for a selection that hasn't changed.
    if (!composerContextHasOurKeyRef.current) {
      sentSelectionIdRef.current = selectionId;
    }
    return;
  } else {
    // Same selection, still present in the shared store, nothing to do —
    // avoid republishing (and thus avoid the feedback loop above) when
    // nothing about the selection actually changed.
    return;
  }
  mirroredSelectionIdRef.current = selectionId;

  const shortLabel = getSelectionShortLabel({
    textContent: selectedElement.textContent,
    layerName: selectedCodeLayerNode?.layerName,
    elementId: selectedElement.id,
    tagName: selectedElement.tagName,
  });
  const targetNodeId =
    selectedCodeLayerNode?.dataAttributes[
      "data-agent-native-node-id"
    ]?.trim() ??
    selectedElement.sourceId ??
    null;
  const targetSelector =
    selectedCodeLayerNode?.selector ?? selectedElement.selector ?? null;
  // Excerpt the outerHTML out of the SOURCE projection rather than the
  // rendered DOM: this is the exact text edit-design's search/replace has
  // to match, so an edit anchored to it cannot drift onto a child or
  // sibling that merely measures the same on canvas.
  const selectedNodeSpan = selectedCodeLayerNode?.source;
  const outerHtmlExcerpt = selectedNodeSpan
    ? nodeRepromptSubtreeExcerpt(
        activeProjectionContent.slice(
          selectedNodeSpan.start,
          selectedNodeSpan.end,
        ),
      )
    : "";
  const contextLines = [
    referenceActive
      ? `Selected design element in design "${design?.title ?? id}" — tagged as a REFERENCE for this generation.`
      : `Selected design element in design "${design?.title ?? id}".`,
    `designId: ${id}`,
    activeFile ? `fileId: ${activeFile.id}` : "",
    activeFile ? `Active screen: ${activeFile.filename}` : "",
    `target: ${targetNodeId ?? targetSelector ?? "unknown"}`,
    targetNodeId ? `targetNodeId: ${targetNodeId}` : "",
    targetSelector ? `targetSelector: ${targetSelector}` : "",
    `Element: <${selectedElement.tagName.toLowerCase()}> ${shortLabel}`,
    selectedCodeLayerNode ? `Code layer id: ${selectedCodeLayerNode.id}` : "",
    selectedElement.classes.length
      ? `Classes: ${selectedElement.classes.join(" ")}`
      : "",
    selectedElement.textContent?.trim()
      ? `Text: ${selectedElement.textContent.trim()}`
      : "",
    ...(referenceActive ? structuralReferenceDirectives(shortLabel) : []),
    outerHtmlExcerpt
      ? `--- selected element (outerHTML excerpt, truncated) ---\n${outerHtmlExcerpt}`
      : "",
  ].filter(Boolean);

  setAgentChatContextItem({
    key,
    title: referenceActive ? `Reference: ${shortLabel}` : shortLabel,
    context: contextLines.join("\n"),
    openSidebar: false,
    // Mirror the selection into chat context without stealing focus: this
    // effect re-fires on every selection change and on each get-design poll
    // during an agent run, and focusing the composer here would blur (and
    // tear down) an in-progress inline text edit on the canvas.
    focus: false,
  });
  composerContextHasOurKeyRef.current = true;
}
