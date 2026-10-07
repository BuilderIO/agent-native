export interface MissingFigmaImage {
  fileId: string;
  hash: string;
  layerName: string | null;
}

export function listMissingFigmaImages(
  screens: Array<{ fileId: string; html: string }>,
): MissingFigmaImage[] {
  const parser = new DOMParser();
  const seen = new Set<string>();
  const images: MissingFigmaImage[] = [];
  for (const { fileId, html } of screens) {
    if (!html.includes("data-figma-image-ref")) continue;
    const doc = parser.parseFromString(html, "text/html");
    for (const element of doc.querySelectorAll<HTMLElement>(
      "[data-figma-image-ref]",
    )) {
      const hashes = (element.dataset.figmaImageRef ?? "").trim().split(/\s+/);
      for (const hash of hashes) {
        const key = `${fileId}:${hash}`;
        if (!hash || seen.has(key)) continue;
        seen.add(key);
        images.push({
          fileId,
          hash,
          layerName: element.dataset.agentNativeLayerName?.trim() || null,
        });
      }
    }
  }
  return images;
}
