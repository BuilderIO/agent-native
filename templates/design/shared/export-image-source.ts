import { fromCanvasImageUrl, restoreCanvasImageUrls } from "./canvas-image-url";

const EXPORT_IMAGE_NATURAL_WIDTH =
  "data-agent-native-export-image-natural-width";

export function isResponsiveExportImage(image: HTMLImageElement): boolean {
  return (
    image.hasAttribute("srcset") ||
    Boolean(image.closest("picture")?.querySelector("source[srcset]")) ||
    image.hasAttribute(EXPORT_IMAGE_NATURAL_WIDTH)
  );
}

export function copyExportImageSource(
  source: HTMLImageElement,
  clone: HTMLImageElement,
): void {
  if (source.currentSrc) clone.setAttribute("src", source.currentSrc);
  if (isResponsiveExportImage(source)) {
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

export function canvasImageOrigin(document: Document): string | undefined {
  return (
    document
      .querySelector("script[data-agent-native-canvas-image-bootstrap]")
      ?.getAttribute("data-origin") ?? undefined
  );
}

export function restoreCanvasImageSources(
  root: Element | Document,
  origin: string,
): void {
  const elements = Array.from(
    root.querySelectorAll("img,source,style,[style]"),
  );
  if (root.nodeType === Node.ELEMENT_NODE) elements.unshift(root as Element);
  for (const element of elements) {
    for (const name of ["src", "srcset", "style"]) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const restored = restoreCanvasImageUrls(value, origin);
      if (restored !== value) element.setAttribute(name, restored);
    }
    if (element.localName === "style" && element.textContent) {
      const restored = restoreCanvasImageUrls(element.textContent, origin);
      if (restored !== element.textContent) element.textContent = restored;
    }
  }
}

export async function prepareExportImageSource(
  source: HTMLImageElement,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  let image = source;
  const origin = canvasImageOrigin(source.ownerDocument);
  const proxied =
    origin !== undefined &&
    fromCanvasImageUrl(source.currentSrc, origin) !== null;
  if (proxied || (source.loading === "lazy" && !source.complete)) {
    const picture = source.closest("picture");
    let clonedRoot: Element;
    if (picture) {
      const sourceImages = Array.from(picture.querySelectorAll("img"));
      const imageIndex = sourceImages.indexOf(source);
      clonedRoot = picture.cloneNode(true) as Element;
      const clonedImage = clonedRoot.querySelectorAll("img")[imageIndex];
      if (!clonedImage) {
        throw new Error("Export image source is unavailable.");
      }
      image = clonedImage;
    } else {
      image = source.cloneNode(true) as HTMLImageElement;
      clonedRoot = image;
    }
    if (origin !== undefined) restoreCanvasImageSources(clonedRoot, origin);
    image.loading = "eager";
  }
  await decodeExportImage(image, signal);
  return image;
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
