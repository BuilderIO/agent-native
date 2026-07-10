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
