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
  const origins = layers.map((layer) => layer.origin);
  const known = origins.filter((origin) => origin !== null);
  const minX = Math.min(...known.map((origin) => origin.x));
  const minY = Math.min(...known.map((origin) => origin.y));
  let stackedX = placeAt.x;
  return layers.map((layer, index) => {
    const origin = origins[index];
    const position = origin
      ? { x: placeAt.x + origin.x - minX, y: placeAt.y + origin.y - minY }
      : { x: stackedX, y: placeAt.y };
    stackedX += (layer.width ?? 0) + FRAME_GAP;
    return position;
  });
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
