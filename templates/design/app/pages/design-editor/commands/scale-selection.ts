import type { ScaleAnchor } from "@/components/design/edit-panel/scale-properties";
import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
import type { ElementInfo } from "@/components/design/types";

/**
 * Asks only the selection's own document to scale it. The selector is not
 * unique across documents, so broadcasting also scaled breakpoint previews
 * and any other screen with a matching element.
 */
export function runScaleSelection(
  args: {
    selectedElement: ElementInfo | null;
    boardFileId: string | null | undefined;
    fallbackIframe: HTMLIFrameElement | null;
  },
  factor: number,
  anchor: ScaleAnchor,
) {
  const selector = args.selectedElement?.selector;
  if (!selector) return;
  const screenId = args.selectedElement?.sourceLayerIdentity?.screenId;
  const iframe =
    (screenId
      ? findCanvasIframeForScreen(
          document.body,
          screenId,
          args.boardFileId ?? undefined,
        )
      : null) ?? args.fallbackIframe;
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
