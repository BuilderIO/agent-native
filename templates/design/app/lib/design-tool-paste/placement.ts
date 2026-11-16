import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

// Matches FRAME_GAP in server/lib/import-design-files.ts.
const FRAME_GAP = 96;

/**
 * Where each pasted frame goes on the overview canvas: relative offsets from
 * the source canvas are kept so a multi-frame copy lands as it was arranged,
 * and frames with no source position are laid out left to right.
 */
export function framePositions(
  layers: readonly FigmaPasteLayer[],
  placeAt: { x: number; y: number } | null,
): Array<{ x: number; y: number } | null> {
  if (!placeAt) return layers.map(() => null);
  const known = layers.flatMap((layer) =>
    layer.origin ? [{ origin: layer.origin, width: layer.width ?? 0 }] : [],
  );
  const minX = Math.min(...known.map(({ origin }) => origin.x));
  const minY = Math.min(...known.map(({ origin }) => origin.y));
  // Frames without a source position start past the right edge of the ones
  // that have one, so they cannot land on top of them.
  let stackedX =
    known.length > 0
      ? placeAt.x +
        Math.max(...known.map(({ origin, width }) => origin.x - minX + width)) +
        FRAME_GAP
      : placeAt.x;
  return layers.map((layer) => {
    if (layer.origin) {
      return {
        x: placeAt.x + layer.origin.x - minX,
        y: placeAt.y + layer.origin.y - minY,
      };
    }
    const position = { x: stackedX, y: placeAt.y };
    stackedX += (layer.width ?? 0) + FRAME_GAP;
    return position;
  });
}

/**
 * Groups items into requests that stay under both the item and byte limits,
 * keeping each item's original index. An item over the byte limit goes alone.
 */
export function packBatches<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  maxItems: number,
  maxBytes: number,
): Array<Array<{ item: T; index: number }>> {
  const batches: Array<Array<{ item: T; index: number }>> = [];
  let current: Array<{ item: T; index: number }> = [];
  let bytes = 0;
  items.forEach((item, index) => {
    const size = sizeOf(item);
    if (
      current.length > 0 &&
      (current.length >= maxItems || bytes + size > maxBytes)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push({ item, index });
    bytes += size;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

const MAX_FILENAME_LENGTH = 80;

/**
 * A filename for a created screen. The server rejects names with slashes or
 * "..", and Figma frame names are full of them ("Components/Button"), so the
 * title is reduced to a plain slug here; the screen keeps its real title.
 */
export function frameFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/-+$/g, "");
  return slug || "pasted-frame";
}
