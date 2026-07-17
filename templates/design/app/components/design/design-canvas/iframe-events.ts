import type { CanvasLayerHitCandidate, ElementInfo } from "../types";

export interface IframeHotkeyPayload {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface IframeFigmaClipboardPastePayload {
  content: string;
}

export interface IframeContextMenuPayload {
  screenId?: string;
  clientX: number;
  clientY: number;
  viewportClientX?: number;
  viewportClientY?: number;
  info?: ElementInfo | null;
  layerCandidates?: CanvasLayerHitCandidate[];
}

export interface IframeNodeHtmlPreviewTarget {
  nodeId?: string;
  selector?: string;
}

export interface IframeNodeHtmlPreviewMessage {
  type: "node-html-preview";
  proposalId: string;
  target: IframeNodeHtmlPreviewTarget;
  operation: "preview" | "restore";
  html?: string;
}

export interface IframeNodeHtmlPreviewAppliedPayload {
  type: "agent-native:node-html-preview-applied";
  proposalId: string;
}
