import type { ElementInfo, PortableStyleSnapshot } from "../types";
import { designPreviewWindowsForScreen } from "./measure-selection";

export type PortableStyleSnapshotRead =
  | { status: "captured"; snapshot: PortableStyleSnapshot }
  | { status: "failed" }
  | { status: "missing" };

export type SubtreeColorStylesRead =
  | { status: "captured"; nodes: Array<Record<string, string>> }
  | { status: "truncated"; nodes: Array<Record<string, string>> }
  | { status: "failed" }
  | { status: "missing" };

/** The nth (1-based) element matching `selector`; repeated instances share it. */
export interface FrameElementTarget {
  selector: string;
  instanceIndex: number;
}

export function frameElementTarget(
  selector: string,
  selection: Pick<ElementInfo, "repeat">,
): FrameElementTarget {
  return selection.repeat?.sourceSelector
    ? {
        selector: selection.repeat.sourceSelector,
        instanceIndex: selection.repeat.instanceIndex,
      }
    : { selector, instanceIndex: 1 };
}

interface EditorChromeBridgeWindow extends Window {
  __anEditorChromeBridgeInstance?: {
    collectPortableStyleSnapshot?: (
      screenId: string,
      selector: string,
      instanceIndex: number,
    ) => PortableStyleSnapshotRead | null;
    collectSubtreeColorStyles?: (
      screenId: string,
      selector: string,
      instanceIndex: number,
    ) => SubtreeColorStylesRead | null;
  };
}

// Breakpoint frames share their screen's id, so only the frame the selection
// came from has the styles it was made at.
function selectionFrameBridge(
  screenId: string,
  breakpointWidth: number | undefined,
  boardFileId: string | undefined,
): EditorChromeBridgeWindow["__anEditorChromeBridgeInstance"] {
  const [preview] = designPreviewWindowsForScreen(
    screenId,
    breakpointWidth,
    boardFileId,
  );
  if (!preview) return undefined;
  try {
    return (preview as EditorChromeBridgeWindow).__anEditorChromeBridgeInstance;
    // coercion-ok: a cross-origin frame ships its snapshot with each selection instead.
  } catch {
    return undefined;
  }
}

// Both readers copy the result into this realm: a frame's own object kept by
// the clipboard would pin that frame's whole realm after it is evicted.
/** Synchronous so copy can still write the clipboard inside the user's gesture. */
export function readPortableStyleSnapshot(
  screenId: string,
  target: FrameElementTarget,
  breakpointWidth: number | undefined,
  boardFileId: string | undefined,
): PortableStyleSnapshotRead {
  const read = selectionFrameBridge(
    screenId,
    breakpointWidth,
    boardFileId,
  )?.collectPortableStyleSnapshot?.(
    screenId,
    target.selector,
    target.instanceIndex,
  );
  return read ? structuredClone(read) : { status: "missing" };
}

export function readSubtreeColorStyles(
  screenId: string,
  target: FrameElementTarget,
  breakpointWidth: number | undefined,
  boardFileId: string | undefined,
): SubtreeColorStylesRead {
  const read = selectionFrameBridge(
    screenId,
    breakpointWidth,
    boardFileId,
  )?.collectSubtreeColorStyles?.(
    screenId,
    target.selector,
    target.instanceIndex,
  );
  return read ? structuredClone(read) : { status: "missing" };
}
