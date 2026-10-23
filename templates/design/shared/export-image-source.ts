const EXPORT_IMAGE_NATURAL_WIDTH =
  "data-agent-native-export-image-natural-width";

export function copyExportImageSource(
  source: HTMLImageElement,
  clone: HTMLImageElement,
): void {
  if (source.currentSrc) clone.setAttribute("src", source.currentSrc);
  if (
    source.hasAttribute("srcset") ||
    source.closest("picture")?.querySelector("source[srcset]") ||
    source.hasAttribute(EXPORT_IMAGE_NATURAL_WIDTH)
  ) {
    clone.setAttribute(EXPORT_IMAGE_NATURAL_WIDTH, String(source.naturalWidth));
  }
  clone.removeAttribute("srcset");
}

export async function decodeExportImage(
  image: HTMLImageElement,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let onAbort: () => void;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort!);
  }
}

export async function resolveExportImageSource(
  image: Element,
  source: string,
  signal: AbortSignal,
): Promise<void> {
  const naturalWidth = image.getAttribute(EXPORT_IMAGE_NATURAL_WIDTH);
  if (naturalWidth === null) {
    image.removeAttribute("srcset");
    return;
  }
  const width = Number(naturalWidth);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Responsive export image is not ready.");
  }
  // CSSOM naturalWidth already includes srcset density; decoding the chosen
  // asset alone recovers its physical width without guessing picture support.
  const intrinsic = new Image();
  intrinsic.src = source;
  await decodeExportImage(intrinsic, signal);
  const density = intrinsic.naturalWidth / width;
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error("Responsive export image dimensions are unavailable.");
  }
  image.removeAttribute("src");
  const srcsetSource = source.replace(
    /[ \t\n\f\r]/g,
    (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
  image.setAttribute("srcset", `${srcsetSource} ${density}x`);
}
