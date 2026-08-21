import {
  removeAgentChatContextItem,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import type { CodeLayerNode } from "@shared/code-layer";
import type { RefObject } from "react";

import type { ElementInfo } from "@/components/design/types";
import { nodeRepromptSubtreeExcerpt } from "@/lib/node-reprompt";
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
  selectedCodeLayerNode,
  selectedElement,
  sentSelectionIdRef,
}: MirrorSelectionToAgentChatArgs) {
  const key = "design:selected-element";
  if (!isSignedIn) return;
  if (!id || !shouldMirrorSelectedElementToAgentChat(selectedElement)) {
    mirroredSelectionIdRef.current = null;
    sentSelectionIdRef.current = null;
    removeAgentChatContextItem(key);
    return;
  }

  const selectionId = `${activeFile?.id ?? ""}::${selectedElement.sourceId ?? selectedElement.selector}`;
  if (selectionId !== mirroredSelectionIdRef.current) {
    // A genuinely new/changed selection always (re)attaches, regardless of
    // whether the previous one was marked sent.
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

  const labelSource =
    selectedElement.textContent?.trim() ||
    selectedCodeLayerNode?.layerName ||
    selectedElement.id ||
    selectedElement.tagName.toLowerCase();
  const shortLabel =
    labelSource.length > 28 ? `${labelSource.slice(0, 25)}...` : labelSource;
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
    `Selected design element in design "${design?.title ?? id}".`,
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
    outerHtmlExcerpt
      ? `--- selected element (outerHTML excerpt, truncated) ---\n${outerHtmlExcerpt}`
      : "",
  ].filter(Boolean);

  setAgentChatContextItem({
    key,
    title: shortLabel,
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
