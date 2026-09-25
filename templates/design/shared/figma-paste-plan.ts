/**
 * Where a Figma paste lands, measured against Figma: inside the selected frame
 * (or the selected layer's parent) when it is on screen, otherwise centred in
 * the viewport — inside the top-level frame that fully contains it, or at the
 * top level. These helpers are the pure part of that decision.
 */

export interface FigmaPasteLayer {
  title: string;
  width: number | null;
  height: number | null;
  /** A full HTML document whose body holds one root element. */
  content: string;
  /** The root is a synthetic frame around one loose node; paste the node. */
  wrapsLooseNode: boolean;
  /** Top-left on the Figma page; null when the converter could not tell. */
  origin: { x: number; y: number } | null;
  /** Top-left relative to the frame it was copied out of in Figma. */
  sourceOffset: { x: number; y: number } | null;
}

export interface PasteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaPasteContainer {
  fileId: string;
  /** Selector of the frame layer inside the screen; null for the screen. */
  selector: string | null;
  width: number;
  height: number;
  /** The part on screen, in the container's own coordinates. */
  visible: PasteRect | null;
  /** Auto-layout frames take a pasted layer as their last flow child. */
  autoLayout: boolean;
}

export interface FigmaPasteScene {
  container: FigmaPasteContainer | null;
  /** The visible canvas, in canvas coordinates. */
  viewport: PasteRect | null;
  screens: Array<PasteRect & { fileId: string }>;
}

export type FigmaPastePlan =
  | {
      kind: "layers";
      fileId: string;
      selector: string | null;
      /** null: append as a flow child. */
      positions: Array<{ x: number; y: number } | null>;
    }
  | { kind: "board"; positions: Array<{ x: number; y: number }> }
  | { kind: "screens"; placeAt: { x: number; y: number } | null };

/** The copied layers as one box, keeping their arrangement. */
function groupOf(layers: ReadonlyArray<FigmaPasteLayer>) {
  const origins = layers.every((layer) => layer.origin)
    ? layers.map((layer) => layer.origin!)
    : layers.map(() => ({ x: 0, y: 0 }));
  const minX = Math.min(...origins.map((o) => o.x));
  const minY = Math.min(...origins.map((o) => o.y));
  const offsets = origins.map((o) => ({ x: o.x - minX, y: o.y - minY }));
  const width = Math.max(
    ...layers.map((layer, i) => offsets[i]!.x + (layer.width ?? 0)),
  );
  const height = Math.max(
    ...layers.map((layer, i) => offsets[i]!.y + (layer.height ?? 0)),
  );
  const first = layers[0]!.sourceOffset;
  const sourceOffset = first
    ? { x: first.x - offsets[0]!.x, y: first.y - offsets[0]!.y }
    : null;
  return { offsets, width, height, sourceOffset };
}

function clamp(value: number, max: number) {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

/**
 * Figma keeps the offset from the frame the paste was copied out of when it
 * starts inside the target and the paste fits; a paste larger than the target
 * goes to its top-left; anything else is centred in the target's visible part.
 */
export function placeInFigmaPasteContainer(
  paste: {
    width: number;
    height: number;
    sourceOffset: { x: number; y: number } | null;
  },
  container: Pick<FigmaPasteContainer, "width" | "height" | "visible">,
): { x: number; y: number } {
  if (paste.width > container.width || paste.height > container.height) {
    return { x: 0, y: 0 };
  }
  const offset = paste.sourceOffset;
  if (
    offset &&
    offset.x >= 0 &&
    offset.y >= 0 &&
    offset.x < container.width &&
    offset.y < container.height
  ) {
    return offset;
  }
  const visible = container.visible ?? {
    x: 0,
    y: 0,
    width: container.width,
    height: container.height,
  };
  return {
    x: clamp(
      visible.x + (visible.width - paste.width) / 2,
      container.width - paste.width,
    ),
    y: clamp(
      visible.y + (visible.height - paste.height) / 2,
      container.height - paste.height,
    ),
  };
}

export function planFigmaPaste(
  layers: ReadonlyArray<FigmaPasteLayer>,
  scene: FigmaPasteScene,
): FigmaPastePlan {
  const group = groupOf(layers);
  const container = scene.container;
  if (container?.visible) {
    if (container.autoLayout) {
      return {
        kind: "layers",
        fileId: container.fileId,
        selector: container.selector,
        positions: layers.map(() => null),
      };
    }
    const at = placeInFigmaPasteContainer(group, container);
    return {
      kind: "layers",
      fileId: container.fileId,
      selector: container.selector,
      positions: group.offsets.map((o) => ({ x: at.x + o.x, y: at.y + o.y })),
    };
  }
  const viewport = scene.viewport;
  if (!viewport) return { kind: "screens", placeAt: null };
  const at = {
    x: viewport.x + (viewport.width - group.width) / 2,
    y: viewport.y + (viewport.height - group.height) / 2,
  };
  const screen = scene.screens.find(
    (s) =>
      at.x >= s.x &&
      at.y >= s.y &&
      at.x + group.width <= s.x + s.width &&
      at.y + group.height <= s.y + s.height,
  );
  if (screen) {
    return {
      kind: "layers",
      fileId: screen.fileId,
      selector: null,
      positions: group.offsets.map((o) => ({
        x: at.x - screen.x + o.x,
        y: at.y - screen.y + o.y,
      })),
    };
  }
  if (layers.every((layer) => layer.wrapsLooseNode)) {
    return {
      kind: "board",
      positions: group.offsets.map((o) => ({ x: at.x + o.x, y: at.y + o.y })),
    };
  }
  return { kind: "screens", placeAt: at };
}
