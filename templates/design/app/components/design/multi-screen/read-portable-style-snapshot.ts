import type { PortableStyleSnapshot } from "../types";
import { designPreviewWindowsForScreen } from "./measure-selection";

export type PortableStyleSnapshotRead =
  | { status: "captured"; snapshot: PortableStyleSnapshot }
  | { status: "failed" }
  | { status: "missing" };

export type SubtreeColorStylesRead =
  | { status: "captured"; nodes: Array<Record<string, string>> }
  | { status: "failed" }
  | { status: "missing" };

interface EditorChromeBridgeWindow extends Window {
  __anEditorChromeBridgeInstance?: {
    collectPortableStyleSnapshot?: (
      screenId: string,
      selector: string,
    ) => PortableStyleSnapshotRead | null;
    collectSubtreeColorStyles?: (
      screenId: string,
      selector: string,
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

/** Synchronous so copy can still write the clipboard inside the user's gesture. */
export function readPortableStyleSnapshot(
  screenId: string,
  selector: string,
  breakpointWidth: number | undefined,
  boardFileId: string | undefined,
): PortableStyleSnapshotRead {
  return (
    selectionFrameBridge(
      screenId,
      breakpointWidth,
      boardFileId,
    )?.collectPortableStyleSnapshot?.(screenId, selector) ?? {
      status: "missing",
    }
  );
}

export function readSubtreeColorStyles(
  screenId: string,
  selector: string,
  breakpointWidth: number | undefined,
  boardFileId: string | undefined,
): SubtreeColorStylesRead {
  return (
    selectionFrameBridge(
      screenId,
      breakpointWidth,
      boardFileId,
    )?.collectSubtreeColorStyles?.(screenId, selector) ?? {
      status: "missing",
    }
  );
}
