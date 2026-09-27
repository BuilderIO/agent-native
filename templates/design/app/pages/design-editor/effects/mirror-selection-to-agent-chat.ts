import {
  removeAgentChatContextItem,
  setAgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import type { CodeLayerNode } from "@shared/code-layer";
import type { RefObject } from "react";

import type { ElementInfo } from "@/components/design/types";
import { nodeRepromptSubtreeExcerpt } from "@/lib/node-reprompt";
import { structuralReferenceDirectives } from "@/pages/design-editor/generation-prompt-directives";
import { shouldMirrorSelectedElementToAgentChat } from "@/pages/design-editor/selection-state";
import type { DesignData, DesignFile } from "@/pages/design-editor/types";

export interface MirrorSelectionToAgentChatArgs {
  activeFile: DesignFile;
  activeProjectionContent: string;
  composerContextHasOurKeyRef: RefObject<boolean>;
  design: DesignData | null;
  id: string | undefined;
  isSignedIn: boolean;
  mirroredExcerptRef: RefObject<string | null>;
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
  mirroredExcerptRef,
  mirroredSelectionIdRef,
  selectedCodeLayerNode,
  selectedElement,
  sentSelectionIdRef,
}: MirrorSelectionToAgentChatArgs) {
  const key = "design:selected-element";
  if (!isSignedIn) return;
  if (!id || !shouldMirrorSelectedElementToAgentChat(selectedElement)) {
    mirroredSelectionIdRef.current = null;
    mirroredExcerptRef.current = null;
    sentSelectionIdRef.current = null;
    removeAgentChatContextItem(key);
    return;
  }

  const selectionId = `${activeFile?.id ?? ""}::${selectedElement.sourceId ?? selectedElement.selector}`;
  const selectedNodeSpan = selectedCodeLayerNode?.source;
  const outerHtmlExcerpt = selectedNodeSpan
    ? nodeRepromptSubtreeExcerpt(
        activeProjectionContent.slice(
          selectedNodeSpan.start,
          selectedNodeSpan.end,
        ),
      )
    : "";

  if (selectionId !== mirroredSelectionIdRef.current) {
    sentSelectionIdRef.current = null;
  } else if (
    sentSelectionIdRef.current === selectionId ||
    !composerContextHasOurKeyRef.current
  ) {
    if (!composerContextHasOurKeyRef.current) {
      sentSelectionIdRef.current = selectionId;
    }
    return;
  } else if (outerHtmlExcerpt === mirroredExcerptRef.current) {
    return;
  }
  mirroredSelectionIdRef.current = selectionId;
  mirroredExcerptRef.current = outerHtmlExcerpt;

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
    ...structuralReferenceDirectives(shortLabel),
    outerHtmlExcerpt
      ? `--- selected element (outerHTML excerpt, truncated) ---\n${outerHtmlExcerpt}`
      : "",
  ].filter(Boolean);

  setAgentChatContextItem({
    key,
    title: shortLabel,
    context: contextLines.join("\n"),
    openSidebar: false,
    focus: false,
  });
  composerContextHasOurKeyRef.current = true;
}
