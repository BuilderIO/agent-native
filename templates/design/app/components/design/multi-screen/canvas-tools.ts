import type { MultiScreenCanvasTool, DraftCreationTool } from "./types";

export function normalizeCanvasTool(
  tool: MultiScreenCanvasTool,
): MultiScreenCanvasTool {
  return tool === "rectangle" ? "rect" : tool;
}

export function getDraftCreationTool(
  tool: MultiScreenCanvasTool,
): DraftCreationTool | null {
  if (
    tool === "frame" ||
    tool === "rect" ||
    tool === "line" ||
    tool === "arrow" ||
    tool === "ellipse" ||
    tool === "polygon" ||
    tool === "star" ||
    tool === "text" ||
    tool === "pen"
  ) {
    return tool;
  }
  return null;
}

export function isDirectScreenHoverTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
) {
  if (target === currentTarget) return true;
  const element =
    target && typeof (target as Element).closest === "function"
      ? (target as Element)
      : null;
  return !!element && !element.closest("[data-screen-content]");
}

/** True only for native OS file drags, not internal HTML drag operations. */
export function isOsFileDrag(event: {
  dataTransfer: { types: readonly string[] | DOMStringList } | null;
}): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === "Files") return true;
  }
  return false;
}

export function shouldBoardSurfaceCapturePointerEvents(args: {
  tool: string;
  gestureActive?: boolean;
}) {
  if (args.gestureActive) return false;
  const tool = normalizeCanvasTool(args.tool as MultiScreenCanvasTool);
  return (
    !getDraftCreationTool(tool) &&
    tool !== "hand" &&
    tool !== "comment" &&
    tool !== "draw"
  );
}

export function shouldBeginCanvasPan(args: { button: number; tool: string }) {
  return (
    args.button === 1 ||
    (args.button === 0 &&
      normalizeCanvasTool(args.tool as MultiScreenCanvasTool) === "hand")
  );
}

export function shouldShowFrameFullViewButton(args: {
  emphasized: boolean;
  showFullView?: boolean;
  childHoverActive?: boolean;
}) {
  return args.emphasized || !!args.showFullView || !!args.childHoverActive;
}

export function shouldShowBreakpointMenuAffordance(args: {
  canEdit: boolean;
  hasRemoveOrChangeWidth: boolean;
  isActive: boolean;
  menuOpen: boolean;
}): boolean {
  return (
    args.canEdit &&
    args.hasRemoveOrChangeWidth &&
    (args.isActive || args.menuOpen)
  );
}

export function shouldClearSelectionOnEmptyCanvasClick(gesture: {
  hasMoved: boolean;
  additive: boolean;
}): boolean {
  return !gesture.hasMoved && !gesture.additive;
}
