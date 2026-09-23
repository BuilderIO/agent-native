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
  /** Empty when the canvas saw a Figma-looking paste it could not read. */
  content: string;
  svgFileError?: "too-large" | "unreadable";
  /** Screen iframe that received the paste, if any. */
  sourceScreenId?: string;
  /** Sanitized by the host before insertion; relayed when ordinary SVG is copied. */
  svg?: string;
  html?: string;
  text?: string;
}

export interface IframeImagePasteFile {
  dataUrl: string;
  type: string;
  name: string;
}

export interface IframeImagePastePayload {
  files: IframeImagePasteFile[];
  screenId?: string;
}

export interface IframeContextMenuPayload {
  screenId?: string;
  breakpointWidthPx?: number;
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
