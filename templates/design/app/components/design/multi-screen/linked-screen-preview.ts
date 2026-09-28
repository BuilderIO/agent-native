import type { RelativeStyleOperation } from "../edit-panel/style-change-types";
import { getBreakpointIframeId, getPrimaryIframeId } from "./iframe-targeting";

export type LinkedScreenPreviewReplaceFn = (
  nextContent: string,
  selector?: string | null,
  candidates?: string[],
  options?: {
    forceFullDocument?: boolean;
    preserveTextEditingSession?: boolean;
  },
) => boolean;

export type LinkedScreenPreviewStyleFn = (
  selector: string,
  property: string,
  value: string,
  options?: {
    selectorCandidates?: string[];
    nodeId?: string | null;
    phase?: string;
    relativeOperation?: RelativeStyleOperation;
  },
) => boolean;

export type LinkedScreenPreviewInteractionStateFn = (args: {
  selector: string;
  selectorCandidates?: string[];
  nodeId?: string | null;
  state: string;
  styles: Record<string, string>;
  routePath?: string;
}) => boolean;

export type LinkedScreenPreviewPendingDeleteFn = (args: {
  selector: string;
  selectorCandidates: string[];
  requestId: string;
  transactionId?: string;
}) => boolean;

export type LinkedScreenPreviewCancelPendingDeleteFn = (args: {
  selector?: string;
  selectorCandidates?: string[];
  requestId: string;
  transactionId?: string;
}) => boolean;

type LinkedPreviewHandlers = {
  replaceContent: LinkedScreenPreviewReplaceFn;
  sendStyleChange: LinkedScreenPreviewStyleFn;
  pendingDelete?: LinkedScreenPreviewPendingDeleteFn;
  cancelPendingDelete?: LinkedScreenPreviewCancelPendingDeleteFn;
  sendInteractionStatePreviewStyle?: LinkedScreenPreviewInteractionStateFn;
};

const linkedPreviewHandlersByFrameId = new Map<string, LinkedPreviewHandlers>();

export function isLinkedScreenPreviewFrameId(
  screenId: string,
  frameId: string,
): boolean {
  if (!screenId || !frameId) return false;
  if (frameId === getPrimaryIframeId(screenId)) return true;
  return frameId.startsWith(`${screenId}::bp-`);
}

export function linkedScreenPreviewFrameIds(
  screenId: string,
  breakpointWidths: readonly number[] = [],
): string[] {
  return [
    getPrimaryIframeId(screenId),
    ...breakpointWidths.map((widthPx) =>
      getBreakpointIframeId(screenId, widthPx),
    ),
  ];
}

export function registerLinkedScreenPreviewHandlers(
  frameId: string,
  handlers: LinkedPreviewHandlers,
): () => void {
  if (!frameId) return () => {};
  linkedPreviewHandlersByFrameId.set(frameId, handlers);
  return () => {
    if (linkedPreviewHandlersByFrameId.get(frameId) === handlers) {
      linkedPreviewHandlersByFrameId.delete(frameId);
    }
  };
}

export function replaceLinkedScreenPreviewContent(
  screenId: string,
  nextContent: string,
  selector?: string | null,
  candidates?: string[],
  options?: {
    forceFullDocument?: boolean;
    preserveTextEditingSession?: boolean;
  },
): boolean {
  if (!screenId) return false;
  let replaced = false;
  for (const [frameId, handlers] of linkedPreviewHandlersByFrameId) {
    if (!isLinkedScreenPreviewFrameId(screenId, frameId)) continue;
    if (handlers.replaceContent(nextContent, selector, candidates, options)) {
      replaced = true;
    }
  }
  return replaced;
}

export function sendLinkedScreenPreviewStyleChange(
  screenId: string,
  selector: string,
  property: string,
  value: string,
  options?: {
    selectorCandidates?: string[];
    nodeId?: string | null;
    phase?: string;
    relativeOperation?: RelativeStyleOperation;
  },
): boolean {
  if (!screenId) return false;
  let sent = false;
  for (const [frameId, handlers] of linkedPreviewHandlersByFrameId) {
    if (!isLinkedScreenPreviewFrameId(screenId, frameId)) continue;
    if (handlers.sendStyleChange(selector, property, value, options)) {
      sent = true;
    }
  }
  return sent;
}

export function sendLinkedScreenPreviewPendingDelete(
  screenId: string,
  args: Parameters<LinkedScreenPreviewPendingDeleteFn>[0],
): boolean {
  if (!screenId) return false;
  let sent = false;
  for (const [frameId, handlers] of linkedPreviewHandlersByFrameId) {
    if (!isLinkedScreenPreviewFrameId(screenId, frameId)) continue;
    if (handlers.pendingDelete?.(args)) sent = true;
  }
  return sent;
}

export function sendLinkedScreenPreviewCancelPendingDelete(
  screenId: string,
  args: Parameters<LinkedScreenPreviewCancelPendingDeleteFn>[0],
): boolean {
  if (!screenId) return false;
  let sent = false;
  for (const [frameId, handlers] of linkedPreviewHandlersByFrameId) {
    if (!isLinkedScreenPreviewFrameId(screenId, frameId)) continue;
    if (handlers.cancelPendingDelete?.(args)) sent = true;
  }
  return sent;
}

export function sendLinkedScreenPreviewInteractionStateStyle(
  screenId: string,
  args: Parameters<LinkedScreenPreviewInteractionStateFn>[0],
): boolean {
  if (!screenId) return false;
  let sent = false;
  for (const [frameId, handlers] of linkedPreviewHandlersByFrameId) {
    if (!isLinkedScreenPreviewFrameId(screenId, frameId)) continue;
    if (handlers.sendInteractionStatePreviewStyle?.(args)) sent = true;
  }
  return sent;
}

export function __clearLinkedScreenPreviewHandlersForTests() {
  linkedPreviewHandlersByFrameId.clear();
}

export function __linkedScreenPreviewHandlerCountForTests() {
  return linkedPreviewHandlersByFrameId.size;
}
