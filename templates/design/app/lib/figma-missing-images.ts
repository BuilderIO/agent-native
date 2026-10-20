export interface MissingFigmaImage {
  hash: string;
  fileIds: string[];
  layerName: string | null;
}

// Keyed by hash, like the import's unresolvedImages count: one image reused on
// several screens is one missing image, filled everywhere by one upload.
export function listMissingFigmaImages(
  screens: Array<{ fileId: string; html: string }>,
): MissingFigmaImage[] {
  const parser = new DOMParser();
  const byHash = new Map<string, MissingFigmaImage>();
  for (const { fileId, html } of screens) {
    if (!html.includes("data-figma-image-ref")) continue;
    const doc = parser.parseFromString(html, "text/html");
    for (const element of doc.querySelectorAll<HTMLElement>(
      "[data-figma-image-ref]",
    )) {
      const hashes = (element.dataset.figmaImageRef ?? "").trim().split(/\s+/);
      for (const hash of hashes) {
        if (!hash) continue;
        const image = byHash.get(hash);
        if (!image) {
          byHash.set(hash, {
            hash,
            fileIds: [fileId],
            layerName: element.dataset.agentNativeLayerName?.trim() || null,
          });
        } else if (!image.fileIds.includes(fileId)) {
          image.fileIds.push(fileId);
        }
      }
    }
  }
  return [...byHash.values()];
}
