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

/** True when `frameId` is the primary iframe or a `::bp-<width>` sibling of
 *  `screenId`. Used so undo/redo and style commits can target every linked
 *  breakpoint preview that shares one design_files row. */
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

/** Replace document content in every mounted linked preview for this screen
 *  (primary + breakpoint sub-frames). Each DesignCanvas applies its own
 *  embedded-frame wrapping. */
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

/** Apply a runtime style patch to every mounted linked preview for this
 *  screen so base edits that cascade across breakpoints stay visually in
 *  sync before the next full-document replace. */
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

/** Apply an interaction-state preview only to the mounted frames for one
 * screen. The active route is checked by each frame handler before posting so
 * overview siblings cannot paint a preview onto a different route. */
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

/** Test-only: drop every registered linked-preview handler. */
export function __clearLinkedScreenPreviewHandlersForTests() {
  linkedPreviewHandlersByFrameId.clear();
}

/** Test-only: how many linked-preview handlers are currently registered. */
export function __linkedScreenPreviewHandlerCountForTests() {
  return linkedPreviewHandlersByFrameId.size;
}
