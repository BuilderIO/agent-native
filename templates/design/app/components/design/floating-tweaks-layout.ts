export type PanelRect = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export type FloatingPanelPosition = { x: number; y: number };

const DEFAULT_POSITION = { x: 16, y: 64 };
const DEFAULT_INSET = 16;

export function resolveFloatingTweaksPosition({
  canvas,
  panel,
  viewport,
  position,
  leftObstruction,
  rightObstruction,
  bottomObstruction,
}: {
  canvas: PanelRect;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  position: FloatingPanelPosition;
  leftObstruction?: PanelRect | undefined;
  rightObstruction?: PanelRect | undefined;
  bottomObstruction?: PanelRect | undefined;
}): { x: number; y: number } {
  const untouchedDefault =
    position.x === DEFAULT_POSITION.x && position.y === DEFAULT_POSITION.y;
  let left = canvas.left;
  let right = canvas.right;
  let bottom = canvas.bottom;

  if (leftObstruction && leftObstruction.bottom > canvas.top) {
    left = Math.max(left, leftObstruction.right);
  }
  if (rightObstruction && rightObstruction.bottom > canvas.top) {
    right = Math.min(right, rightObstruction.left);
  }

  const x = untouchedDefault
    ? left + DEFAULT_INSET
    : viewport.width - position.x - panel.width;
  const defaultY = bottom - panel.height - DEFAULT_INSET;
  const y = untouchedDefault
    ? bottomObstruction &&
      bottomObstruction.left < left + DEFAULT_INSET + panel.width &&
      bottomObstruction.right > left + DEFAULT_INSET
      ? Math.min(defaultY, bottomObstruction.top - panel.height - 8)
      : defaultY
    : viewport.height - position.y - panel.height;

  return {
    x: Math.min(Math.max(x, left), Math.max(left, right - panel.width)),
    y: Math.min(
      Math.max(y, canvas.top),
      Math.max(canvas.top, bottom - panel.height),
    ),
  };
}

export function shouldAutoCollapseFloatingTweaks(
  inspectorVisible: boolean,
  inspectorHasTweaks: boolean,
): boolean {
  return inspectorVisible && inspectorHasTweaks;
}
