import type {
  DesignHotkeyAlignEdge,
  DesignHotkeyDistributeAxis,
} from "@/hooks/useDesignHotkeys";

/**
 * Generic rect shape shared by the alignment/distribute/tidy pure helpers.
 * Works for overview screen frames and in-screen layer nodes.
 */
export interface AlignableRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mergeAuthoredAndLiveRect(args: {
  id: string;
  authored: Partial<Omit<AlignableRect, "id">>;
  live: Omit<AlignableRect, "id"> | null;
}): AlignableRect {
  const resolve = (authored: number | undefined, live: number | undefined) =>
    Number.isFinite(authored)
      ? (authored as number)
      : Number.isFinite(live)
        ? (live as number)
        : 0;
  return {
    id: args.id,
    x: resolve(args.authored.x, args.live?.x),
    y: resolve(args.authored.y, args.live?.y),
    width: resolve(args.authored.width, args.live?.width),
    height: resolve(args.authored.height, args.live?.height),
  };
}

export function computeAlignedPositions(
  rects: readonly AlignableRect[],
  bounds: { x: number; y: number; width: number; height: number },
  edge: DesignHotkeyAlignEdge,
): Map<string, { x: number; y: number }> {
  const next = new Map<string, { x: number; y: number }>();
  for (const rect of rects) {
    let x = rect.x;
    let y = rect.y;
    switch (edge) {
      case "left":
        x = bounds.x;
        break;
      case "right":
        x = bounds.x + bounds.width - rect.width;
        break;
      case "center-h":
        x = bounds.x + (bounds.width - rect.width) / 2;
        break;
      case "top":
        y = bounds.y;
        break;
      case "bottom":
        y = bounds.y + bounds.height - rect.height;
        break;
      case "center-v":
        y = bounds.y + (bounds.height - rect.height) / 2;
        break;
    }
    x = Math.round(x);
    y = Math.round(y);
    if (x !== Math.round(rect.x) || y !== Math.round(rect.y)) {
      next.set(rect.id, { x, y });
    }
  }
  return next;
}

export function computeDistributedPositions(
  rects: readonly AlignableRect[],
  axis: DesignHotkeyDistributeAxis,
): Map<string, { x: number; y: number }> {
  const next = new Map<string, { x: number; y: number }>();
  if (rects.length < 3) return next;
  const sorted = [...rects].sort((a, b) =>
    axis === "horizontal" ? a.x - b.x : a.y - b.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const size = (rect: AlignableRect) =>
    axis === "horizontal" ? rect.width : rect.height;
  const start = (rect: AlignableRect) =>
    axis === "horizontal" ? rect.x : rect.y;
  const totalSpan = start(last) + size(last) - start(first);
  const totalContentSize = sorted.reduce((sum, rect) => sum + size(rect), 0);
  const gapCount = sorted.length - 1;
  const gap = (totalSpan - totalContentSize) / gapCount;
  let cursor = start(first) + size(first) + gap;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const rect = sorted[index]!;
    const position = Math.round(cursor);
    if (position !== Math.round(start(rect))) {
      next.set(
        rect.id,
        axis === "horizontal"
          ? { x: position, y: rect.y }
          : { x: rect.x, y: position },
      );
    }
    cursor += size(rect) + gap;
  }
  return next;
}

/** One screen's own frame box plus the footprint its responsive row occupies. */
export interface ReflowCandidate {
  id: string;
  /** Resolved frame geometry, including screens with no persisted entry yet. */
  geometry: { x: number; y: number; width: number; height: number };
  /** Space actually painted, breakpoint frames included. */
  footprint: AlignableRect;
}

function footprintsOverlap(rects: readonly AlignableRect[]): boolean {
  return rects.some((a, i) =>
    rects.some(
      (b, j) =>
        i !== j &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );
}

/**
 * Re-packs a board whose responsive rows have grown into each other, returning
 * complete geometry per screen — including screens that had no persisted entry
 * and were positioned by `getInitialFrameGeometry`. Returning only the moved
 * x/y would drop those screens at the write-back, which is exactly the
 * default-layout board that needs the reflow most.
 *
 * Empty when there is nothing to do, so a deliberately arranged,
 * non-overlapping board is never rearranged.
 */
export function computeOverlapReflowGeometry(
  candidates: readonly ReflowCandidate[],
): Map<string, { x: number; y: number; width: number; height: number }> {
  const result = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  if (candidates.length < 2) return result;
  const footprints = candidates.map((candidate) => candidate.footprint);
  if (!footprintsOverlap(footprints)) return result;
  const positions = computeTidyPositions(footprints);
  if (positions.size === 0) return result;
  for (const candidate of candidates) {
    const position = positions.get(candidate.id);
    if (!position) continue;
    // Translate by the footprint's delta rather than adopting the packed origin
    // as the frame origin. A rotated group's AABB origin is not its frame
    // origin, so assigning it directly shifts the frame by the rotation offset.
    result.set(candidate.id, {
      ...candidate.geometry,
      x: candidate.geometry.x + (position.x - candidate.footprint.x),
      y: candidate.geometry.y + (position.y - candidate.footprint.y),
    });
  }
  return result;
}

export function computeTidyPositions(
  rects: readonly AlignableRect[],
): Map<string, { x: number; y: number }> {
  const next = new Map<string, { x: number; y: number }>();
  if (rects.length === 0) return next;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const median = (values: number[]): number => {
    const sortedValues = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2 === 0
      ? (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
      : sortedValues[mid]!;
  };
  const cellWidth = median(sorted.map((rect) => rect.width));
  const cellHeight = median(sorted.map((rect) => rect.height));
  let gap = 24;
  const gapsFound: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = 0; j < sorted.length; j += 1) {
      if (i === j) continue;
      const a = sorted[i]!;
      const b = sorted[j]!;
      const verticallyOverlaps = a.y < b.y + b.height && b.y < a.y + a.height;
      if (!verticallyOverlaps) continue;
      const candidateGap = b.x - (a.x + a.width);
      if (candidateGap > 0) gapsFound.push(candidateGap);
    }
  }
  if (gapsFound.length > 0) gap = Math.max(...gapsFound);
  const originX = Math.min(...sorted.map((rect) => rect.x));
  const originY = Math.min(...sorted.map((rect) => rect.y));
  sorted.forEach((rect, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.round(originX + col * (cellWidth + gap));
    const y = Math.round(originY + row * (cellHeight + gap));
    if (x !== Math.round(rect.x) || y !== Math.round(rect.y)) {
      next.set(rect.id, { x, y });
    }
  });
  return next;
}

export function inferAutoLayoutFromChildren(
  container: { x: number; y: number; width: number; height: number },
  children: readonly AlignableRect[],
): {
  direction: "row" | "column";
  gap: number;
  padding: number;
} {
  if (children.length === 0) {
    return { direction: "column", gap: 10, padding: 0 };
  }
  // Live Figma defaults a one-item Shift+A wrapper to vertical flow even
  // when the item itself is much wider than it is tall. With no relationship
  // between multiple children to infer, use that stable default rather than
  // allowing the selected child's aspect ratio to choose the axis.
  if (children.length === 1) {
    return { direction: "column", gap: 10, padding: 0 };
  }
  const minX = Math.min(...children.map((child) => child.x));
  const maxX = Math.max(...children.map((child) => child.x + child.width));
  const minY = Math.min(...children.map((child) => child.y));
  const maxY = Math.max(...children.map((child) => child.y + child.height));
  const spreadWidth = maxX - minX;
  const spreadHeight = maxY - minY;
  const direction: "row" | "column" =
    spreadWidth >= spreadHeight ? "row" : "column";
  const sorted = [...children].sort((a, b) =>
    direction === "row" ? a.x - b.x : a.y - b.y,
  );
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1]!;
    const current = sorted[index]!;
    const gapValue =
      direction === "row"
        ? current.x - (prev.x + prev.width)
        : current.y - (prev.y + prev.height);
    if (Number.isFinite(gapValue) && gapValue > 0) gaps.push(gapValue);
  }
  const median = (values: number[]): number => {
    const sortedValues = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2 === 0
      ? (sortedValues[mid - 1]! + sortedValues[mid]!) / 2
      : sortedValues[mid]!;
  };
  const gap = gaps.length > 0 ? Math.round(median(gaps)) : 10;
  const insets = [
    minX - container.x,
    minY - container.y,
    container.x + container.width - maxX,
    container.y + container.height - maxY,
  ].filter((inset) => Number.isFinite(inset));
  const padding =
    insets.length > 0 ? Math.max(0, Math.round(Math.min(...insets))) : 0;
  return { direction, gap, padding };
}
