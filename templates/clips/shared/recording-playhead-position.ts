export type RecordingPlayheadOrientation = "horizontal" | "vertical";
export type RecordingPlayheadDock =
  | "free"
  | "left"
  | "right"
  | "top"
  | "bottom";
export type RecordingPlayheadDockMode = "floating" | "docked";
export type RecordingPlayheadDockLocation = Exclude<
  RecordingPlayheadDock,
  "free"
>;
export type RecordingPlayheadDockSlot = "top" | "middle" | "bottom";

export type RecordingPlayheadSize = {
  width: number;
  height: number;
};

export type RecordingPlayheadViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RecordingPlayheadPosition = {
  left: number;
  top: number;
  orientation: RecordingPlayheadOrientation;
  dock: RecordingPlayheadDock;
  slot: RecordingPlayheadDockSlot | null;
};

export const RECORDING_PLAYHEAD_GUTTER = 16;
export const RECORDING_PLAYHEAD_EDGE_THRESHOLD = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dockSlotForTop(
  top: number,
  size: RecordingPlayheadSize,
  viewport: RecordingPlayheadViewport,
): RecordingPlayheadDockSlot {
  const center = top + size.height / 2;
  const middle = viewport.top + viewport.height / 2;
  return center < middle - viewport.height / 6
    ? "top"
    : center > middle + viewport.height / 6
      ? "bottom"
      : "middle";
}

export function positionRecordingPlayheadAtDock(
  dock: Exclude<RecordingPlayheadDock, "free">,
  slot: RecordingPlayheadDockSlot | null,
  size: RecordingPlayheadSize,
  viewport: RecordingPlayheadViewport,
  gutter = RECORDING_PLAYHEAD_GUTTER,
): { left: number; top: number } {
  const proposedLeft =
    dock === "right"
      ? viewport.left + viewport.width - size.width - gutter
      : dock === "left"
        ? viewport.left + gutter
        : viewport.left + (viewport.width - size.width) / 2;
  const proposedTop =
    dock === "top"
      ? viewport.top + gutter
      : dock === "bottom"
        ? viewport.top + viewport.height - size.height - gutter
        : slot === "top"
          ? viewport.top + gutter
          : slot === "bottom"
            ? viewport.top + viewport.height - size.height - gutter
            : viewport.top + (viewport.height - size.height) / 2;

  return {
    left: clamp(
      proposedLeft,
      viewport.left + gutter,
      viewport.left + viewport.width - size.width - gutter,
    ),
    top: clamp(
      proposedTop,
      viewport.top + gutter,
      viewport.top + viewport.height - size.height - gutter,
    ),
  };
}

export function clampRecordingPlayheadPosition(
  left: number,
  top: number,
  size: RecordingPlayheadSize,
  viewport: RecordingPlayheadViewport,
  gutter = RECORDING_PLAYHEAD_GUTTER,
): { left: number; top: number } {
  return {
    left: clamp(
      left,
      viewport.left + gutter,
      viewport.left + viewport.width - size.width - gutter,
    ),
    top: clamp(
      top,
      viewport.top + gutter,
      viewport.top + viewport.height - size.height - gutter,
    ),
  };
}

/**
 * Snap one axis to a screen edge while preserving the user's position on the
 * other axis. Desktop dragging uses this instead of the preset slot geometry:
 * docking should feel like the pill met an edge, not like it teleported to a
 * different place on that edge.
 */
export function positionRecordingPlayheadAtEdge(
  dock: Exclude<RecordingPlayheadDock, "free">,
  proposedLeft: number,
  proposedTop: number,
  size: RecordingPlayheadSize,
  viewport: RecordingPlayheadViewport,
  gutter = RECORDING_PLAYHEAD_GUTTER,
): { left: number; top: number } {
  const clamped = clampRecordingPlayheadPosition(
    proposedLeft,
    proposedTop,
    size,
    viewport,
    gutter,
  );

  if (dock === "left") {
    return { ...clamped, left: viewport.left + gutter };
  }
  if (dock === "right") {
    return {
      ...clamped,
      left: Math.max(
        viewport.left + gutter,
        viewport.left + viewport.width - size.width - gutter,
      ),
    };
  }
  if (dock === "top") {
    return { ...clamped, top: viewport.top + gutter };
  }
  return {
    ...clamped,
    top: Math.max(
      viewport.top + gutter,
      viewport.top + viewport.height - size.height - gutter,
    ),
  };
}

export function dockRecordingPlayhead(
  proposedLeft: number,
  proposedTop: number,
  sizes: {
    horizontal: RecordingPlayheadSize;
    vertical: RecordingPlayheadSize;
  },
  viewport: RecordingPlayheadViewport,
  gutter = RECORDING_PLAYHEAD_GUTTER,
  edgeThreshold = RECORDING_PLAYHEAD_EDGE_THRESHOLD,
): RecordingPlayheadPosition {
  const proposedRight = proposedLeft + sizes.horizontal.width;
  const viewportRight = viewport.left + viewport.width;
  const nearLeft = proposedLeft <= viewport.left + gutter + edgeThreshold;
  const nearRight = proposedRight >= viewportRight - gutter - edgeThreshold;

  if (nearLeft || nearRight) {
    const dock: Exclude<RecordingPlayheadDock, "free"> = nearRight
      ? "right"
      : "left";
    const slot = dockSlotForTop(proposedTop, sizes.vertical, viewport);
    const position = positionRecordingPlayheadAtDock(
      dock,
      slot,
      sizes.vertical,
      viewport,
      gutter,
    );
    return { ...position, orientation: "vertical", dock, slot };
  }

  const position = clampRecordingPlayheadPosition(
    proposedLeft,
    proposedTop,
    sizes.horizontal,
    viewport,
    gutter,
  );
  return {
    ...position,
    orientation: "horizontal",
    dock: "free",
    slot: null,
  };
}

export function resizeRecordingPlayheadPosition(
  position: RecordingPlayheadPosition,
  sizes: {
    horizontal: RecordingPlayheadSize;
    vertical: RecordingPlayheadSize;
  },
  viewport: RecordingPlayheadViewport,
  gutter = RECORDING_PLAYHEAD_GUTTER,
): RecordingPlayheadPosition {
  if (position.dock === "left" || position.dock === "right") {
    if (!position.slot) {
      return {
        ...position,
        orientation: "horizontal",
        dock: "free",
        slot: null,
      };
    }
    const docked = positionRecordingPlayheadAtDock(
      position.dock,
      position.slot,
      sizes.vertical,
      viewport,
      gutter,
    );
    return { ...position, ...docked, orientation: "vertical" };
  }

  if (position.dock === "top" || position.dock === "bottom") {
    const docked = positionRecordingPlayheadAtDock(
      position.dock,
      null,
      sizes.horizontal,
      viewport,
      gutter,
    );
    return { ...position, ...docked, orientation: "horizontal", slot: null };
  }

  const clamped = clampRecordingPlayheadPosition(
    position.left,
    position.top,
    sizes.horizontal,
    viewport,
    gutter,
  );
  return { ...position, ...clamped, orientation: "horizontal", dock: "free" };
}
