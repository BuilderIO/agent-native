import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";

import type { PortableStyleSnapshot } from "@/components/design/types";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import type { DesignClipboardManagedStyleSnapshot } from "@/lib/design-clipboard-managed-styles";

import type { PendingLiveStructureEdit } from "./pending-edits";

/**
 * Local alias for DesignCanvas's inline `embeddedFrame` prop type (not
 * exported from DesignCanvas.tsx) so the per-screen cache can be typed.
 */
export type DesignCanvasEmbeddedFrame = {
  viewportWidth: number;
  viewportHeight: number;
  displayWidth: number;
  displayHeight: number;
  fluid?: boolean;
  contentOffsetX?: number;
  contentOffsetY?: number;
};

export interface LiveScreenSnapshot {
  url: string;
  html: string;
  status?: number;
  contentType?: string;
}

export interface RuntimeLayerSnapshot {
  html: string;
  nodeCount: number;
  documentId?: string;
}

export type PendingStructureVerificationStatus =
  | "idle"
  | "checking-source"
  | "awaiting-source"
  | "awaiting-runtime"
  | "conflict";

export interface PendingStructureVerificationSource {
  connectionId: string;
  path: string;
  baselineVersionHash: string;
}

export interface PendingStructureVerificationSession {
  requestId: number;
  cancelled: boolean;
  edits: PendingLiveStructureEdit[];
  sources: PendingStructureVerificationSource[];
}

export type PostAuthDesignIntent = "save" | "share";

export type ShareExportFormat = "html" | "png" | "svg" | "zip";

export interface CodingHandoffResult {
  clipboardText?: string;
  prompt?: string;
  rawUrl?: string;
  zipUrl?: string;
  fileCount?: number;
}

export interface CanvasLayerClipboardEntry {
  html: string;
  rootNodeId?: string;
  sourceFileId: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
  managedStyleSnapshot?: DesignClipboardManagedStyleSnapshot;
}

export interface SelectedCanvasLayerSnapshot extends CanvasLayerClipboardEntry {
  node: CodeLayerNode;
  sourceIndex: number;
  tree: CodeLayerTreeNode[];
}

export type PatchProofStatus =
  | "runtime"
  | "queued"
  | "applied"
  | "failed"
  | "rolledBack";

export interface PatchProofState {
  id: string;
  fileId: string;
  filename: string;
  selector: string;
  sourceId?: string;
  property: string;
  previousValue?: string;
  nextValue: string;
  previousContent?: string;
  capability: string;
  confidence?: number;
  status: PatchProofStatus;
  error?: string;
  createdAt: number;
}

export type ResponsiveEditScope = "cascade-smaller" | "only";

export interface RetryablePrompt {
  prompt: string;
  files: UploadedFile[];
  model?: PromptComposerSubmitOptions["model"];
  engine?: PromptComposerSubmitOptions["engine"];
  effort?: PromptComposerSubmitOptions["effort"];
  designSystemId?: string | null;
  attempt?: number;
  source?: string;
  templateId?: string;
  templateBaselineFiles?: Array<{ id: string; contentHash: string }>;
}
