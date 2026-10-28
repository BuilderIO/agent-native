import type { ScaleAnchor } from "@/components/design/edit-panel/scale-properties";
import {
  findCanvasIframeForScreen,
  getBreakpointIframeId,
} from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";

export function runScaleSelection(
  args: {
    selectedElement: ElementInfo | null;
    boardFileId: string | null | undefined;
    activeBreakpointWidthPx: number | undefined;
    fallbackIframe: HTMLIFrameElement | null;
  },
  factor: number,
  anchor: ScaleAnchor,
) {
  const selector = args.selectedElement?.selector;
  if (!selector) return;
  const screenId = args.selectedElement?.sourceLayerIdentity?.screenId;
  const breakpointIframe =
    screenId && args.activeBreakpointWidthPx !== undefined
      ? findCanvasIframeForScreen(
          document.body,
          getBreakpointIframeId(screenId, args.activeBreakpointWidthPx),
        )
      : null;
  const iframe =
    breakpointIframe ??
    (screenId
      ? findCanvasIframeForScreen(
          document.body,
          screenId,
          args.boardFileId ?? undefined,
        )
      : null) ??
    args.fallbackIframe;
  iframe?.contentWindow?.postMessage(
    {
      type: "agent-native:scale-selection",
      selector,
      factor,
      anchorX: anchor.x,
      anchorY: anchor.y,
    },
    "*",
  );
}
