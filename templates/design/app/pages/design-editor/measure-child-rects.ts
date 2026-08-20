export interface FreeformGeometry {
  container: { width: number; height: number } | null;
  children: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
}

const NOTHING_MEASURED: FreeformGeometry = { container: null, children: {} };

/**
 * Container-relative geometry for a node and its direct children, read from
 * whichever preview iframe actually holds the node — the board and each screen
 * have their own document, so a single global iframe lookup finds the wrong one.
 */
export function measureFreeformGeometry(nodeId: string): FreeformGeometry {
  if (typeof document === "undefined") return NOTHING_MEASURED;
  const selector = `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`;
  const iframes = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe],iframe[data-screen-iframe-id]",
    ),
  );
  for (const iframe of iframes) {
    let container: HTMLElement | null = null;
    try {
      container =
        iframe.contentDocument?.querySelector<HTMLElement>(selector) ?? null;
    } catch {
      // Cross-origin preview surfaces are not measurable; try the next one.
      continue;
    }
    if (!container) continue;
    const view = container.ownerDocument.defaultView;
    const origin = container.getBoundingClientRect();
    // Absolute offsets resolve against the padding box, but a client rect is
    // the border box, so a bordered container shifts every child it pins.
    const borders = view?.getComputedStyle(container);
    const originLeft = origin.left + edgeWidth(borders?.borderLeftWidth);
    const originTop = origin.top + edgeWidth(borders?.borderTopWidth);
    const rects: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {};
    for (const child of Array.from(container.children)) {
      const childId = child.getAttribute("data-agent-native-node-id");
      if (!childId) continue;
      const rect = child.getBoundingClientRect();
      rects[childId] = {
        x: rect.left - originLeft,
        y: rect.top - originTop,
        width: rect.width,
        height: rect.height,
      };
    }
    // Own box, in the same box-sizing terms as a width/height declaration on
    // this element, so writing it back reproduces the rendered size.
    const own = borders
      ? {
          width: Number.parseFloat(borders.width),
          height: Number.parseFloat(borders.height),
        }
      : null;
    return {
      container:
        own && Number.isFinite(own.width) && Number.isFinite(own.height)
          ? own
          : null,
      children: rects,
    };
  }
  return NOTHING_MEASURED;
}

function edgeWidth(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  // A missing or non-length border computes to no edge; both mean zero inset.
  return Number.isFinite(parsed) ? parsed : 0;
}
