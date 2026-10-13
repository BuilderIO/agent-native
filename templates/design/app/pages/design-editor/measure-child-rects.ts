export interface FreeformGeometry {
  container: { width: number; height: number } | null;
  children: Record<
    string,
    { x: number; y: number; width: number; height: number }
  >;
}

const NOTHING_MEASURED: FreeformGeometry = { container: null, children: {} };

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
      continue;
    }
    if (!container) continue;
    const view = container.ownerDocument.defaultView;
    const origin = container.getBoundingClientRect();
    const borders = view?.getComputedStyle(container);
    const originLeft =
      origin.left + edgeWidth(borders?.borderLeftWidth) - container.scrollLeft;
    const originTop =
      origin.top + edgeWidth(borders?.borderTopWidth) - container.scrollTop;
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
  return Number.isFinite(parsed) ? parsed : 0;
}
