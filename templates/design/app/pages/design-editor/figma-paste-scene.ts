import type {
  FigmaPasteContainer,
  FigmaPasteScene,
  PasteRect,
} from "@shared/figma-paste-plan";

import { findCanvasIframeForScreen } from "@/components/design/multi-screen/iframe-targeting";
import { resolveFigmaPasteTargetScreenId } from "@/lib/figma-paste-layers";

/**
 * Reads what a Figma paste needs to know from the live canvas: the selected
 * container and its on-screen part, the visible canvas, and every screen.
 */

function intersect(a: PasteRect, b: PasteRect): PasteRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function screenIframe(args: {
  canvasRoot: HTMLElement | null;
  viewMode: "single" | "overview";
  fileId: string;
}): HTMLIFrameElement | null {
  return args.viewMode === "single"
    ? (args.canvasRoot?.querySelector<HTMLIFrameElement>(
        "[data-design-preview-iframe]",
      ) ?? null)
    : findCanvasIframeForScreen(args.canvasRoot, args.fileId);
}

/** The screen's visible part in its own coordinates, in single-screen view. */
function singleViewVisibleRect(
  canvasRoot: HTMLElement,
  iframe: HTMLIFrameElement,
): PasteRect | null {
  const frame = iframe.getBoundingClientRect();
  const scale = iframe.offsetWidth > 0 ? frame.width / iframe.offsetWidth : 1;
  const root = canvasRoot.getBoundingClientRect();
  const visible = intersect(
    { x: root.x, y: root.y, width: root.width, height: root.height },
    { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
  );
  if (!visible || scale <= 0) return null;
  return {
    x: (visible.x - frame.x) / scale,
    y: (visible.y - frame.y) / scale,
    width: visible.width / scale,
    height: visible.height / scale,
  };
}

function nodeSelector(nodeId: string) {
  return `[data-agent-native-node-id="${nodeId.replace(/["\\]/g, "\\$&")}"]`;
}

export function resolveFigmaPasteScene(args: {
  viewMode: "single" | "overview";
  activeFileId: string | undefined;
  boardFileId: string | undefined;
  overviewSelectedScreenIds: readonly string[];
  /** Durable node id of the selected layer, if any. */
  selectedNodeId: string | null;
  /** The selected layer can hold children (a frame), not an object. */
  selectedIsContainer: boolean;
  canvasRoot: HTMLElement | null;
  screens: Array<PasteRect & { fileId: string }>;
  visibleCanvasRect: PasteRect | null;
}): FigmaPasteScene {
  const viewport = args.viewMode === "overview" ? args.visibleCanvasRect : null;
  const scene = { container: null, viewport, screens: args.screens };
  const fileId = resolveFigmaPasteTargetScreenId({
    ...args,
    hasLayerSelection: Boolean(args.selectedNodeId),
  });
  const screen = args.screens.find((entry) => entry.fileId === fileId);
  if (!fileId || !screen) return scene;
  const iframe = screenIframe({ ...args, fileId });
  const visibleInScreen =
    args.viewMode === "single"
      ? iframe && args.canvasRoot
        ? singleViewVisibleRect(args.canvasRoot, iframe)
        : null
      : viewport && {
          ...viewport,
          x: viewport.x - screen.x,
          y: viewport.y - screen.y,
        };
  const screenContainer: FigmaPasteContainer = {
    fileId,
    selector: null,
    width: screen.width,
    height: screen.height,
    visible: visibleInScreen
      ? intersect(visibleInScreen, {
          x: 0,
          y: 0,
          width: screen.width,
          height: screen.height,
        })
      : null,
    autoLayout: false,
  };

  const doc = iframe?.contentDocument;
  const selected =
    args.selectedNodeId && doc
      ? doc.querySelector(nodeSelector(args.selectedNodeId))
      : null;
  const element = args.selectedIsContainer ? selected : selected?.parentElement;
  const elementNodeId = element?.getAttribute("data-agent-native-node-id");
  if (
    !doc?.defaultView ||
    !element ||
    !elementNodeId ||
    element === doc.body ||
    element === doc.documentElement
  ) {
    return { ...scene, container: screenContainer };
  }
  const box = element.getBoundingClientRect();
  const local = {
    x: box.x + doc.defaultView.scrollX,
    y: box.y + doc.defaultView.scrollY,
    width: box.width,
    height: box.height,
  };
  const visible = visibleInScreen && intersect(visibleInScreen, local);
  const display = doc.defaultView.getComputedStyle(element).display;
  return {
    ...scene,
    container: {
      fileId,
      selector: nodeSelector(elementNodeId),
      width: local.width,
      height: local.height,
      visible: visible && {
        ...visible,
        x: visible.x - local.x,
        y: visible.y - local.y,
      },
      autoLayout: /flex|grid/.test(display),
    },
  };
}

/**
 * Absolute children of a statically positioned frame are laid out against an
 * ancestor, so frame-local positions need the frame's offset from it.
 */
export function containingBlockOffset(args: {
  canvasRoot: HTMLElement | null;
  viewMode: "single" | "overview";
  fileId: string;
  selector: string;
}): { x: number; y: number } {
  const doc = screenIframe(args)?.contentDocument;
  const view = doc?.defaultView;
  const element = doc?.querySelector<HTMLElement>(args.selector);
  if (!view || !element) return { x: 0, y: 0 };
  if (view.getComputedStyle(element).position !== "static") {
    return { x: 0, y: 0 };
  }
  const box = element.getBoundingClientRect();
  const parent = element.offsetParent as HTMLElement | null;
  if (!parent || view.getComputedStyle(parent).position === "static") {
    return { x: box.x + view.scrollX, y: box.y + view.scrollY };
  }
  const parentBox = parent.getBoundingClientRect();
  return {
    x: box.x - parentBox.x - parent.clientLeft,
    y: box.y - parentBox.y - parent.clientTop,
  };
}
