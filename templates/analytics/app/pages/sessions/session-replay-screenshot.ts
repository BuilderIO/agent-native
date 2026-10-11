export class ReplayScreenshotAssetError extends Error {
  constructor(
    readonly reason:
      | "unsupportedAsset"
      | "fontReadiness"
      | "cloneDocument"
      | "duplicateCloneMarker"
      | "cloneRoot"
      | "cloneElement"
      | "cloneStageFrame"
      | "clonePseudoElement" = "unsupportedAsset",
  ) {
    super("Replay contains media or images that cannot be captured safely");
    this.name = "ReplayScreenshotAssetError";
  }
}

export class ReplayScreenshotCaptureError extends Error {
  constructor(
    readonly reason:
      | "captureSetup"
      | "replayRender"
      | "stageRender"
      | "pngEncode"
      | "unsupportedColor"
      | "unsupportedImageFunction"
      | "unsupportedTransform"
      | "rendererCloneWindow"
      | "rendererCloneElement",
  ) {
    super("Replay screenshot capture failed");
    this.name = "ReplayScreenshotCaptureError";
  }
}

function rendererFailureReason(
  error: unknown,
  fallback: ReplayScreenshotCaptureError["reason"],
): ReplayScreenshotCaptureError["reason"] {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  // Only fixed codes leave this boundary; renderer errors can contain replay asset URLs.
  if (message.startsWith("Attempting to parse an unsupported color function "))
    return "unsupportedColor";
  if (message.startsWith("Attempting to parse an unsupported image function "))
    return "unsupportedImageFunction";
  if (
    message.startsWith("Attempting to parse an unsupported transform function ")
  )
    return "unsupportedTransform";
  if (
    message === "Unable to find iframe window" ||
    message === "No window assigned for iframe"
  )
    return "rendererCloneWindow";
  if (
    message === "Unable to find element in cloned iframe" ||
    /^Error finding the [A-Z]+ in the cloned document$/.test(message)
  )
    return "rendererCloneElement";
  return fallback;
}

const REMOTE_IMAGE_PREFLIGHT_TIMEOUT_MS = 8_000;
const REMOTE_IMAGE_PREFLIGHT_CONCURRENCY = 2;
const REPLAY_FONT_TIMEOUT_MS = 8_000;
const MAX_INLINE_IMAGE_PIXELS = 8_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 16_000_000;
const MAX_REPLAY_IMAGE_RESOURCES = 128;
const MAX_INLINE_ASSET_BYTES = 32_000_000;
const MAX_IMAGE_RESPONSE_BYTES = 12_000_000;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 16_000_000;
const MAX_CLIPBOARD_PNG_BYTES = 32_000_000;
const MAX_REPLAY_IFRAME_DEPTH = 8;
const VIDEO_READY_STATE_HAVE_CURRENT_DATA = 2;
const REPLAY_SCREENSHOT_MARKER = "data-replay-screenshot-map";

type ReplayImageResource = { document: Document; url: string };
type ReplayScreenshotAssets = Map<Document, Map<string, string>>;
type Html2Canvas = typeof import("html2canvas-pro").default;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, false);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function checkedImageDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_INLINE_IMAGE_PIXELS
  ) {
    throw new ReplayScreenshotAssetError();
  }
  return { height, width };
}

async function imageDimensionsBeforeDecode(blob: Blob): Promise<{
  height: number;
  width: number;
}> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isPng =
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (isPng) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const chunkLength = readUint32BE(bytes, offset);
      const chunkType = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      );
      if (chunkType === "acTL") throw new ReplayScreenshotAssetError();
      if (chunkType === "IDAT") break;
      offset += 12 + chunkLength;
    }
    return checkedImageDimensions(
      readUint32BE(bytes, 16),
      readUint32BE(bytes, 20),
    );
  }

  const isGif =
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)));
  if (isGif) throw new ReplayScreenshotAssetError();

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isJpeg) {
    const frameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++]!;
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        continue;
      }
      const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (frameMarkers.has(marker)) {
        return checkedImageDimensions(
          (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        );
      }
      offset += segmentLength;
    }
    throw new ReplayScreenshotAssetError();
  }

  const isWebp =
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (isWebp) {
    let offset = 12;
    let dimensions: { height: number; width: number } | undefined;
    while (offset + 8 <= bytes.length) {
      const chunkType = String.fromCharCode(
        ...bytes.subarray(offset, offset + 4),
      );
      const chunkLength = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset + 4,
        4,
      ).getUint32(0, true);
      const data = offset + 8;
      if (chunkType === "ANIM" || chunkType === "ANMF") {
        throw new ReplayScreenshotAssetError();
      }
      if (chunkType === "VP8X" && data + 10 <= bytes.length) {
        if ((bytes[data]! & 0x02) !== 0) throw new ReplayScreenshotAssetError();
        dimensions = checkedImageDimensions(
          readUint24LE(bytes, data + 4) + 1,
          readUint24LE(bytes, data + 7) + 1,
        );
      } else if (chunkType === "VP8 " && data + 10 <= bytes.length) {
        dimensions = checkedImageDimensions(
          ((bytes[data + 7]! & 0x3f) << 8) | bytes[data + 6]!,
          ((bytes[data + 9]! & 0x3f) << 8) | bytes[data + 8]!,
        );
      } else if (chunkType === "VP8L" && data + 5 <= bytes.length) {
        if (bytes[data] !== 0x2f) throw new ReplayScreenshotAssetError();
        dimensions = checkedImageDimensions(
          1 + bytes[data + 1]! + ((bytes[data + 2]! & 0x3f) << 8),
          1 +
            (bytes[data + 2]! >> 6) +
            (bytes[data + 3]! << 2) +
            ((bytes[data + 4]! & 0x0f) << 10),
        );
      }
      offset = data + chunkLength + (chunkLength % 2);
    }
    if (dimensions) return dimensions;
  }

  const svgSource = new TextDecoder().decode(bytes);
  if (/<\s*(?:\?xml|svg)\b/i.test(svgSource)) {
    if (
      /<\s*(?:script|foreignObject|animate(?:Motion|Transform)?|set)\b/i.test(
        svgSource,
      ) ||
      /@import|@keyframes|\banimation\s*:/i.test(svgSource)
    ) {
      throw new ReplayScreenshotAssetError();
    }
    const svgDocument = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml",
    );
    const root = svgDocument.documentElement;
    if (root.localName !== "svg" || svgDocument.querySelector("parsererror")) {
      throw new ReplayScreenshotAssetError();
    }
    for (const element of svgDocument.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        if (
          ["href", "xlink:href"].includes(attribute.name.toLowerCase()) &&
          !attribute.value.trim().startsWith("#")
        ) {
          throw new ReplayScreenshotAssetError();
        }
        if (
          cssImageUrlTokens(attribute.value).some(
            (token) => !token.url.startsWith("#"),
          )
        ) {
          throw new ReplayScreenshotAssetError();
        }
      }
    }
    const svgStyle = Array.from(svgDocument.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    if (
      cssImageUrlTokens(svgStyle).some((token) => !token.url.startsWith("#"))
    ) {
      throw new ReplayScreenshotAssetError();
    }
    const parseLength = (value: string | null) => {
      const match = value?.match(/^\s*([\d.]+)(?:px)?\s*$/i);
      return match ? Number(match[1]) : 0;
    };
    const viewBox = root
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const width = parseLength(root.getAttribute("width")) || viewBox?.[2] || 0;
    const height =
      parseLength(root.getAttribute("height")) || viewBox?.[3] || 0;
    return checkedImageDimensions(width, height);
  }
  throw new ReplayScreenshotAssetError();
}

async function boundedImageBlob(response: Response): Promise<Blob> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_IMAGE_RESPONSE_BYTES
  ) {
    throw new ReplayScreenshotAssetError();
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_RESPONSE_BYTES) {
      throw new ReplayScreenshotAssetError();
    }
    return blob;
  }

  const chunks: ArrayBuffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ReplayScreenshotAssetError();
    }
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk.buffer as ArrayBuffer);
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") ?? "",
  });
}

function renderedChildren(node: Node): Node[] {
  const source =
    node.nodeType === 1 ? ((node as Element).shadowRoot ?? node) : node;
  return Array.from(source.childNodes).flatMap((child) => {
    if (child.nodeType === 1 && (child as Element).localName === "slot") {
      const assigned = (child as HTMLSlotElement).assignedNodes();
      if (assigned.length > 0) return assigned;
    }
    return [child];
  });
}

function renderedElements(document: Document): Element[] {
  const root = document.documentElement;
  if (!root) return [];
  const elements: Element[] = [root];
  const visit = (node: Node) => {
    for (const child of renderedChildren(node)) {
      if (child.nodeType !== 1) continue;
      elements.push(child as Element);
      visit(child);
    }
  };
  visit(root);
  return elements;
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root.nodeType === 11 && "host" in root
    ? (root as ShadowRoot).host
    : null;
}

function isElementRendered(element: Element, document: Document): boolean {
  const view = document.defaultView;
  if (!view) return true;

  const elementVisibility = view.getComputedStyle(element).visibility;
  if (elementVisibility === "hidden" || elementVisibility === "collapse") {
    return false;
  }

  for (let current: Element | null = element; current; ) {
    const styles = view.getComputedStyle(current);
    if (
      styles.display === "none" ||
      styles.contentVisibility === "hidden" ||
      (styles.opacity !== "" && Number(styles.opacity) === 0)
    ) {
      return false;
    }
    current = composedParent(current);
  }

  if (typeof element.getBoundingClientRect !== "function") return true;
  const bounds = element.getBoundingClientRect();
  const viewportWidth = view.innerWidth || document.documentElement.clientWidth;
  const viewportHeight =
    view.innerHeight || document.documentElement.clientHeight;
  if (
    bounds.width > 0 &&
    bounds.height > 0 &&
    viewportWidth > 0 &&
    viewportHeight > 0 &&
    (bounds.right <= 0 ||
      bounds.bottom <= 0 ||
      bounds.left >= viewportWidth ||
      bounds.top >= viewportHeight)
  ) {
    return false;
  }

  return true;
}

function replayDocuments(document: Document): Document[] {
  const documents: Document[] = [];
  const visited = new Set<Document>();
  const visit = (current: Document, depth: number) => {
    if (visited.has(current)) return;
    if (depth >= MAX_REPLAY_IFRAME_DEPTH) {
      throw new ReplayScreenshotAssetError();
    }
    visited.add(current);
    documents.push(current);

    for (const frame of renderedElements(current).filter(
      (element): element is HTMLIFrameElement => element.tagName === "IFRAME",
    )) {
      if (!isElementRendered(frame, current)) continue;
      const child = frame.contentDocument;
      if (!child?.documentElement) {
        throw new ReplayScreenshotAssetError();
      }
      visit(child, depth + 1);
    }
  };

  visit(document, 0);
  return documents;
}

export function completeReplayScreenshotCapture(
  activeCapture: { current: AbortController | null },
  capture: AbortController,
  unlockPlayback: () => void,
): boolean {
  if (activeCapture.current !== capture) return false;
  activeCapture.current = null;
  unlockPlayback();
  return true;
}

type CssImageUrlToken = { end: number; start: number; url: string };

function decodeCssUrl(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_match, hex, char) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
  );
}

function cssImageUrlTokens(value: string): CssImageUrlToken[] {
  const tokens: CssImageUrlToken[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    const start = /^url\s*\(/i.exec(value.slice(index));
    if (!start) continue;

    let cursor = index + start[0].length;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
    let url = "";
    const urlQuote =
      value[cursor] === "'" || value[cursor] === '"' ? value[cursor]! : null;
    if (urlQuote) {
      cursor += 1;
      const contentStart = cursor;
      let urlEscaped = false;
      while (cursor < value.length) {
        const current = value[cursor]!;
        if (urlEscaped) urlEscaped = false;
        else if (current === "\\") urlEscaped = true;
        else if (current === urlQuote) break;
        cursor += 1;
      }
      if (cursor >= value.length) throw new ReplayScreenshotAssetError();
      url = value.slice(contentStart, cursor);
      cursor += 1;
      while (/\s/.test(value[cursor] ?? "")) cursor += 1;
      if (value[cursor] !== ")") throw new ReplayScreenshotAssetError();
    } else {
      const contentStart = cursor;
      let urlEscaped = false;
      while (cursor < value.length) {
        const current = value[cursor]!;
        if (urlEscaped) urlEscaped = false;
        else if (current === "\\") urlEscaped = true;
        else if (current === ")") break;
        cursor += 1;
      }
      if (cursor >= value.length) throw new ReplayScreenshotAssetError();
      url = value.slice(contentStart, cursor).trim();
    }
    if (!url) throw new ReplayScreenshotAssetError();
    tokens.push({ end: cursor + 1, start: index, url: decodeCssUrl(url) });
    index = cursor;
  }
  return tokens;
}

function imageResourcesInDocuments(
  documents: Document[],
): ReplayImageResource[] {
  const urlsByDocument = new Map<Document, Set<string>>();
  const addUrl = (value: string, baseURI: string, document: Document) => {
    const normalizedValue = value.trim();
    if (
      /^data:image\//i.test(normalizedValue) &&
      normalizedValue.length > MAX_INLINE_ASSET_BYTES
    ) {
      throw new ReplayScreenshotAssetError();
    }
    const baseUrl = new URL(baseURI);
    const url = new URL(normalizedValue, baseURI);
    if (
      url.hash &&
      url.origin === baseUrl.origin &&
      url.pathname === baseUrl.pathname &&
      url.search === baseUrl.search
    ) {
      return;
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      const urls = urlsByDocument.get(document) ?? new Set<string>();
      urls.add(url.href);
      urlsByDocument.set(document, urls);
    } else if (url.protocol === "data:" && /^data:image\//i.test(url.href)) {
      const urls = urlsByDocument.get(document) ?? new Set<string>();
      urls.add(url.href);
      urlsByDocument.set(document, urls);
    }
  };
  const addCssUrls = (value: string, baseURI: string, document: Document) => {
    if (!value) return;
    if (/(?:-webkit-)?image-set\s*\(/i.test(value)) {
      throw new ReplayScreenshotAssetError();
    }
    for (const token of cssImageUrlTokens(value)) {
      addUrl(token.url, baseURI, document);
    }
  };
  const assertMaskSupported = (value: string) => {
    if (value && value !== "none") {
      throw new ReplayScreenshotAssetError();
    }
  };

  for (const current of documents) {
    const elements = renderedElements(current);
    if (
      elements.some(
        (element) =>
          (element.tagName === "OBJECT" || element.tagName === "EMBED") &&
          isElementRendered(element, current),
      )
    ) {
      throw new ReplayScreenshotAssetError();
    }

    for (const canvas of elements.filter(
      (element): element is HTMLCanvasElement => element.tagName === "CANVAS",
    )) {
      if (!isElementRendered(canvas, current)) continue;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;
      assertScreenshotDimensions(canvas.width, canvas.height);

      const probe = current.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      const context = probe.getContext("2d");
      if (!context) throw new ReplayScreenshotAssetError();
      try {
        context.drawImage(canvas, 0, 0, 1, 1);
        context.getImageData(0, 0, 1, 1);
      } catch {
        throw new ReplayScreenshotAssetError();
      }
    }

    for (const image of elements.filter(
      (element): element is HTMLImageElement => element.tagName === "IMG",
    )) {
      if (!isElementRendered(image, current)) continue;
      const source = image.currentSrc || image.src;
      if (source) addUrl(source, current.baseURI, current);
    }

    for (const image of elements.filter(
      (element): element is HTMLInputElement =>
        element.tagName === "INPUT" &&
        (element as HTMLInputElement).type === "image",
    )) {
      if (!isElementRendered(image, current)) continue;
      if (image.src) addUrl(image.src, current.baseURI, current);
    }

    for (const image of elements.filter(
      (element) =>
        ["image", "use", "feimage"].includes(element.localName.toLowerCase()) &&
        element.namespaceURI === "http://www.w3.org/2000/svg",
    )) {
      if (!isElementRendered(image, current)) continue;
      const source =
        image.getAttribute("href") ||
        image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (
        source &&
        !source.trim().startsWith("#") &&
        !/^data:image\//i.test(source.trim())
      ) {
        throw new ReplayScreenshotAssetError();
      } else if (source && /^data:image\//i.test(source.trim())) {
        addUrl(source, current.baseURI, current);
      }
    }

    for (const video of elements.filter(
      (element): element is HTMLVideoElement => element.tagName === "VIDEO",
    )) {
      if (!isElementRendered(video, current)) continue;
      if (video.controls) throw new ReplayScreenshotAssetError();
      if (hasCurrentVideoFrame(video)) {
        assertVideoFrameReadable(video);
      } else if (video.poster) {
        addUrl(video.poster, current.baseURI, current);
      } else if (
        video.currentSrc ||
        video.hasAttribute("src") ||
        video.srcObject ||
        video.querySelector("source[src]")
      ) {
        throw new ReplayScreenshotAssetError();
      }
    }

    for (const audio of elements.filter(
      (element): element is HTMLAudioElement => element.tagName === "AUDIO",
    )) {
      if (!audio.hasAttribute("controls")) continue;
      if (!isElementRendered(audio, current)) continue;
      throw new ReplayScreenshotAssetError();
    }

    for (const element of elements) {
      if (!isElementRendered(element, current)) continue;
      const view = current.defaultView ?? window;
      const styles = view.getComputedStyle(element);
      addCssUrls(styles.backgroundImage, current.baseURI, current);
      addCssUrls(styles.listStyleImage, current.baseURI, current);
      assertMaskSupported(styles.maskImage);
      assertMaskSupported(styles.getPropertyValue?.("-webkit-mask-image"));
      if (styles.borderImageSource && styles.borderImageSource !== "none") {
        throw new ReplayScreenshotAssetError();
      }

      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyles = view.getComputedStyle(element, pseudo);
        if (
          pseudoStyles.display === "none" ||
          pseudoStyles.visibility === "hidden" ||
          pseudoStyles.visibility === "collapse" ||
          pseudoStyles.content === "none" ||
          pseudoStyles.content === "normal"
        ) {
          continue;
        }
        addCssUrls(pseudoStyles.content, current.baseURI, current);
        addCssUrls(pseudoStyles.backgroundImage, current.baseURI, current);
        addCssUrls(pseudoStyles.listStyleImage, current.baseURI, current);
        assertMaskSupported(pseudoStyles.maskImage);
        assertMaskSupported(
          pseudoStyles.getPropertyValue?.("-webkit-mask-image"),
        );
        if (
          pseudoStyles.borderImageSource &&
          pseudoStyles.borderImageSource !== "none"
        ) {
          throw new ReplayScreenshotAssetError();
        }
      }
    }
  }

  return [...urlsByDocument].flatMap(([document, urls]) =>
    [...urls].map((url) => ({ document, url })),
  );
}

function hasCurrentVideoFrame(video: HTMLVideoElement): boolean {
  return (
    video.readyState >= VIDEO_READY_STATE_HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

function assertVideoFrameReadable(video: HTMLVideoElement): void {
  const probe = video.ownerDocument.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d");
  if (!context) throw new ReplayScreenshotAssetError();
  try {
    context.drawImage(video, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
  } catch {
    throw new ReplayScreenshotAssetError();
  }
}

function copyComputedStyles(
  source: Element,
  target: HTMLElement,
  view: Window,
): void {
  const styles = view.getComputedStyle(source);
  for (let index = 0; index < styles.length; index += 1) {
    const property = styles.item(index);
    target.style.setProperty(
      property,
      styles.getPropertyValue(property),
      styles.getPropertyPriority(property),
    );
  }
}

function html2CanvasVideoClone(
  video: HTMLVideoElement,
  clonesByMarker: Map<string, Element>,
): Element | undefined {
  const parent = video.parentElement;
  const parentMarker = parent?.getAttribute(REPLAY_SCREENSHOT_MARKER);
  const clonedParent = parentMarker ? clonesByMarker.get(parentMarker) : null;
  if (!parent || !clonedParent) return undefined;

  const originalChildren = Array.from(parent.children).filter(
    (element) => element.tagName !== "SCRIPT",
  );
  const videoIndex = originalChildren.indexOf(video);
  if (videoIndex === -1) return undefined;

  const clonedChildren = Array.from(clonedParent.children).filter(
    (element) =>
      element.tagName !== "SCRIPT" &&
      element.localName !== "html2canvaspseudoelement",
  );
  const clone = clonedChildren[videoIndex];
  return clone?.tagName === "CANVAS" ? clone : undefined;
}

function imageUrlsInDocuments(documents: Document[]): string[] {
  return [
    ...new Set(imageResourcesInDocuments(documents).map(({ url }) => url)),
  ];
}

export function crossOriginImageUrls(document: Document): string[] {
  return imageUrlsInDocuments(replayDocuments(document)).filter(
    (url) =>
      /^https?:/i.test(url) && new URL(url).origin !== window.location.origin,
  );
}

export async function assertRemoteImagesCapturable(
  document: Document,
  signal?: AbortSignal,
  credentials: RequestCredentials = "same-origin",
): Promise<ReplayScreenshotAssets> {
  const documents = replayDocuments(document);
  const resources = imageResourcesInDocuments(documents);
  if (resources.length > MAX_REPLAY_IMAGE_RESOURCES) {
    throw new ReplayScreenshotAssetError();
  }
  const assets: ReplayScreenshotAssets = new Map();
  let inlineAssetBytes = 0;
  let inlineImagePixels = 0;
  const controller = new AbortController();
  const abortFromSignal = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortFromSignal, { once: true });
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    REMOTE_IMAGE_PREFLIGHT_TIMEOUT_MS,
  );
  let nextUrlIndex = 0;
  let allCapturable = true;
  const fail = () => {
    allCapturable = false;
    controller.abort();
  };
  const checkNextUrl = async () => {
    while (
      allCapturable &&
      !controller.signal.aborted &&
      nextUrlIndex < resources.length
    ) {
      const resource = resources[nextUrlIndex++];
      try {
        if (
          resource.url.startsWith("data:") &&
          resource.url.length > MAX_INLINE_ASSET_BYTES
        ) {
          throw new ReplayScreenshotAssetError();
        }
        const response = await fetch(resource.url, {
          credentials,
          mode: "cors",
          signal: controller.signal,
        });
        if (!response.ok || response.type === "opaque") {
          throw new ReplayScreenshotAssetError();
        }
        const blob = await boundedImageBlob(response);
        const dimensions = await imageDimensionsBeforeDecode(blob);
        inlineImagePixels += dimensions.width * dimensions.height;
        if (inlineImagePixels > MAX_TOTAL_IMAGE_PIXELS) {
          throw new ReplayScreenshotAssetError();
        }
        if (controller.signal.aborted) throw new ReplayScreenshotAssetError();

        const bitmap = await createImageBitmap(blob);
        try {
          if (controller.signal.aborted) throw new ReplayScreenshotAssetError();
          checkedImageDimensions(bitmap.width, bitmap.height);
          const bitmapPixels = bitmap.width * bitmap.height;
          if (bitmapPixels > dimensions.width * dimensions.height) {
            inlineImagePixels +=
              bitmapPixels - dimensions.width * dimensions.height;
            if (inlineImagePixels > MAX_TOTAL_IMAGE_PIXELS) {
              throw new ReplayScreenshotAssetError();
            }
          }
          const canvas = resource.document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new ReplayScreenshotAssetError();
          context.drawImage(bitmap, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          if (inlineAssetBytes + dataUrl.length > MAX_INLINE_ASSET_BYTES) {
            throw new ReplayScreenshotAssetError();
          }
          inlineAssetBytes += dataUrl.length;
          const documentAssets = assets.get(resource.document) ?? new Map();
          documentAssets.set(resource.url, dataUrl);
          assets.set(resource.document, documentAssets);
        } finally {
          bitmap.close();
        }
      } catch {
        fail();
      }
    }
  };
  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            REMOTE_IMAGE_PREFLIGHT_CONCURRENCY,
            resources.length,
          ),
        },
        () => checkNextUrl(),
      ),
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromSignal);
  }

  if (!allCapturable || controller.signal.aborted) {
    throw new ReplayScreenshotAssetError();
  }

  return assets;
}

function replaceCssImageUrls(
  value: string,
  baseURI: string,
  assets: Map<string, string>,
): string {
  const tokens = cssImageUrlTokens(value);
  if (tokens.length === 0) return value;
  let output = "";
  let cursor = 0;
  for (const token of tokens) {
    let replacement = value.slice(token.start, token.end);
    try {
      const dataUrl = assets.get(new URL(token.url, baseURI).href);
      if (dataUrl) replacement = 'url("' + dataUrl + '")';
    } catch {
      throw new ReplayScreenshotAssetError();
    }
    output += value.slice(cursor, token.start) + replacement;
    cursor = token.end;
  }
  return output + value.slice(cursor);
}

function markedReplayDocuments(
  document: Document,
  captureId: string,
): Document[] {
  const documents: Document[] = [];
  const visited = new Set<Document>();
  const visit = (current: Document) => {
    if (visited.has(current)) return;
    visited.add(current);
    const rootMarker = current.documentElement?.getAttribute(
      REPLAY_SCREENSHOT_MARKER,
    );
    if (rootMarker && new RegExp(`^${captureId}-\\d+-0$`).test(rootMarker)) {
      documents.push(current);
    }
    for (const frame of renderedElements(current).filter(
      (element): element is HTMLIFrameElement => element.tagName === "IFRAME",
    )) {
      const child = frame.contentDocument;
      if (
        child?.documentElement
          ?.getAttribute(REPLAY_SCREENSHOT_MARKER)
          ?.startsWith(`${captureId}-`)
      ) {
        visit(child);
      }
    }
  };
  visit(document);
  return documents;
}

function markReplayElements(
  documents: Document[],
  captureId: string,
): () => void {
  const previous = new Map<Element, string | null>();
  for (const [documentIndex, current] of documents.entries()) {
    for (const [elementIndex, element] of renderedElements(current).entries()) {
      previous.set(element, element.getAttribute(REPLAY_SCREENSHOT_MARKER));
      element.setAttribute(
        REPLAY_SCREENSHOT_MARKER,
        `${captureId}-${documentIndex}-${elementIndex}`,
      );
    }
  }
  return () => {
    for (const [element, value] of previous) {
      if (value === null) element.removeAttribute(REPLAY_SCREENSHOT_MARKER);
      else element.setAttribute(REPLAY_SCREENSHOT_MARKER, value);
    }
  };
}

export function inlineReplayAssets(
  originalDocument: Document,
  clonedDocument: Document,
  assets: ReplayScreenshotAssets,
  captureId: string,
  iframeScreenshots: Map<HTMLIFrameElement, string> = new Map(),
  originalElements = renderedElements(originalDocument),
): void {
  const originalDocuments = [originalDocument];
  const clonedDocuments = markedReplayDocuments(clonedDocument, captureId);
  if (clonedDocuments.length !== 1) {
    throw new ReplayScreenshotAssetError("cloneDocument");
  }

  const clonesByMarker = new Map<string, Element>();
  for (const cloned of clonedDocuments) {
    for (const element of renderedElements(cloned)) {
      const marker = element.getAttribute(REPLAY_SCREENSHOT_MARKER);
      if (!marker?.startsWith(`${captureId}-`)) continue;
      if (clonesByMarker.has(marker)) {
        throw new ReplayScreenshotAssetError("duplicateCloneMarker");
      }
      clonesByMarker.set(marker, element);
    }
  }

  for (const originalElement of originalElements) {
    if (originalElement.tagName !== "VIDEO") continue;
    const marker = originalElement.getAttribute(REPLAY_SCREENSHOT_MARKER);
    if (!marker || clonesByMarker.has(marker)) continue;
    const clone = html2CanvasVideoClone(
      originalElement as HTMLVideoElement,
      clonesByMarker,
    );
    if (clone) clonesByMarker.set(marker, clone);
  }

  for (const [documentIndex, original] of originalDocuments.entries()) {
    const rootMarker = original.documentElement.getAttribute(
      REPLAY_SCREENSHOT_MARKER,
    );
    const cloned = clonedDocuments.find(
      (candidate) =>
        candidate.documentElement.getAttribute(REPLAY_SCREENSHOT_MARKER) ===
        rootMarker,
    );
    if (!cloned || rootMarker !== `${captureId}-${documentIndex}-0`) {
      throw new ReplayScreenshotAssetError("cloneRoot");
    }
    const documentAssets = assets.get(original) ?? new Map();

    const view = original.defaultView ?? window;
    for (const originalElement of originalElements) {
      if (originalElement.tagName === "SCRIPT") continue;
      const marker = originalElement.getAttribute(REPLAY_SCREENSHOT_MARKER);
      let clonedElement = marker ? clonesByMarker.get(marker) : undefined;
      const isHtml2CanvasVideoClone =
        originalElement.tagName === "VIDEO" &&
        clonedElement?.tagName === "CANVAS";
      if (
        !clonedElement ||
        (!isHtml2CanvasVideoClone &&
          originalElement.tagName !== clonedElement.tagName &&
          !originalElement.localName.includes("-"))
      ) {
        throw new ReplayScreenshotAssetError("cloneElement");
      }
      if (originalElement instanceof view.HTMLIFrameElement) {
        const screenshot = iframeScreenshots.get(originalElement);
        if (isElementRendered(originalElement, original) && !screenshot) {
          throw new ReplayScreenshotAssetError();
        }
        if (screenshot) {
          const image = cloned.createElement("img");
          image.alt = "";
          image.src = screenshot;
          copyComputedStyles(originalElement, image, view);
          image.style.setProperty("object-fit", "fill", "important");
          clonedElement.replaceWith(image);
          clonedElement = image;
          if (marker) clonesByMarker.set(marker, image);
        }
      }
      if (originalElement.tagName === "VIDEO") {
        const video = originalElement as HTMLVideoElement;
        if (!hasCurrentVideoFrame(video) && video.poster) {
          const posterUrl = new URL(video.poster, original.baseURI).href;
          const poster = documentAssets.get(posterUrl);
          if (!poster) throw new ReplayScreenshotAssetError();
          const image = cloned.createElement("img");
          image.alt = "";
          image.src = poster;
          const videoStyles = view.getComputedStyle(video);
          copyComputedStyles(video, image, view);
          image.style.setProperty(
            "object-fit",
            videoStyles.objectFit || "contain",
            "important",
          );
          clonedElement.replaceWith(image);
          clonedElement = image;
          if (marker) clonesByMarker.set(marker, image);
        }
      }
      if (originalElement instanceof view.HTMLImageElement) {
        const source = originalElement.currentSrc || originalElement.src;
        const dataUrl = documentAssets.get(source);
        if (dataUrl) {
          clonedElement.removeAttribute("srcset");
          clonedElement.removeAttribute("sizes");
          clonedElement.setAttribute("src", dataUrl);
        }
      } else if (
        originalElement instanceof view.HTMLInputElement &&
        originalElement.type === "image"
      ) {
        const dataUrl = documentAssets.get(originalElement.src);
        if (dataUrl) clonedElement.setAttribute("src", dataUrl);
      }

      const styles = view.getComputedStyle(originalElement);
      const backgroundImage = replaceCssImageUrls(
        styles.backgroundImage,
        original.baseURI,
        documentAssets,
      );
      const listStyleImage = replaceCssImageUrls(
        styles.listStyleImage,
        original.baseURI,
        documentAssets,
      );
      if (backgroundImage !== styles.backgroundImage) {
        (clonedElement as HTMLElement).style.setProperty(
          "background-image",
          backgroundImage,
          "important",
        );
      }
      if (listStyleImage !== styles.listStyleImage) {
        (clonedElement as HTMLElement).style.setProperty(
          "list-style-image",
          listStyleImage,
          "important",
        );
      }

      const pseudoElements = Array.from(clonedElement.children).filter(
        (element) => element.localName === "html2canvaspseudoelement",
      );
      let pseudoElementIndex = 0;
      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyles = view.getComputedStyle(originalElement, pseudo);
        const generatedClass =
          pseudo === "::before"
            ? "___html2canvas___pseudoelement_before"
            : "___html2canvas___pseudoelement_after";
        if (!clonedElement.classList.contains(generatedClass)) continue;
        const pseudoElement = pseudoElements[pseudoElementIndex++];
        if (!pseudoElement) {
          throw new ReplayScreenshotAssetError("clonePseudoElement");
        }
        if (
          pseudoStyles.display === "none" ||
          pseudoStyles.visibility === "hidden" ||
          pseudoStyles.visibility === "collapse" ||
          pseudoStyles.content === "none" ||
          pseudoStyles.content === "normal" ||
          pseudoStyles.content === "-moz-alt-content"
        ) {
          continue;
        }

        const contentUrls = cssImageUrlTokens(pseudoStyles.content);
        const contentImages = Array.from(pseudoElement.querySelectorAll("img"));
        if (contentImages.length !== contentUrls.length) {
          if (contentUrls.length > 0) throw new ReplayScreenshotAssetError();
        } else {
          for (const [index, token] of contentUrls.entries()) {
            const dataUrl = documentAssets.get(
              new URL(token.url, original.baseURI).href,
            );
            if (dataUrl) contentImages[index]!.src = dataUrl;
            else if (!token.url.trim().startsWith("#")) {
              throw new ReplayScreenshotAssetError();
            }
          }
        }

        for (const [property, value] of [
          ["background-image", pseudoStyles.backgroundImage],
          ["list-style-image", pseudoStyles.listStyleImage],
        ] as const) {
          const replaced = replaceCssImageUrls(
            value,
            original.baseURI,
            documentAssets,
          );
          if (replaced !== value) {
            (pseudoElement as HTMLElement).style.setProperty(
              property,
              replaced,
              "important",
            );
          }
        }
      }
    }
  }
}

async function assertDocumentFontsReady(document: Document): Promise<void> {
  // rrweb rebuilds with document.open(); font readiness also waits for parsing to finish.
  if (document.readyState === "loading") document.close();
  const fontSet = document.fonts;
  if (!fontSet?.ready) return;

  let timeoutId: number | undefined;
  try {
    await Promise.race([
      fontSet.ready,
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new ReplayScreenshotAssetError("fontReadiness")),
          REPLAY_FONT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export async function assertReplayFontsReady(
  document: Document,
  signal?: AbortSignal,
): Promise<void> {
  let rejectAbort: (reason?: unknown) => void = () => {};
  const onAbort = () =>
    rejectAbort(new Error("Replay screenshot was cancelled"));
  const abort = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    if (signal?.aborted) {
      reject(new Error("Replay screenshot was cancelled"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([
      Promise.all(replayDocuments(document).map(assertDocumentFontsReady)),
      abort,
    ]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function waitForReplayPaint(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let firstFrame = 0;
    let secondFrame = 0;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const cancel = () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      cleanup();
      reject(new Error("Replay screenshot was cancelled"));
    };
    const abort = () => cancel();
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        cleanup();
        resolve();
      });
    });
  });
}

export class ReplayScreenshotClipboardError extends Error {
  constructor() {
    super("Replay screenshot could not be copied to the clipboard");
    this.name = "ReplayScreenshotClipboardError";
  }
}

export function writeReplayScreenshotToClipboard(
  screenshot: Blob | Promise<Blob>,
  clipboard: Pick<Clipboard, "write"> | undefined = globalThis.navigator
    ?.clipboard,
  onClipboardWriteFailure?: () => void,
): Promise<void> {
  const ClipboardItemConstructor = globalThis.ClipboardItem;
  const boundedPng = Promise.resolve(screenshot).then((blob) => {
    if (
      blob.type !== "image/png" ||
      blob.size === 0 ||
      blob.size > MAX_CLIPBOARD_PNG_BYTES
    ) {
      throw new ReplayScreenshotClipboardError();
    }
    return blob;
  });
  const pngResult = boundedPng.then(
    () => ({ kind: "png-ready" as const }),
    (error: unknown) => ({ error, kind: "png-failed" as const }),
  );

  let clipboardWrite: Promise<void>;
  try {
    if (!clipboard?.write || !ClipboardItemConstructor) {
      throw new ReplayScreenshotClipboardError();
    }

    // Start the clipboard write with the click; the promised PNG can render afterward.
    const item = new ClipboardItemConstructor({ "image/png": boundedPng });
    clipboardWrite = Promise.resolve(clipboard.write([item]));
  } catch (error) {
    clipboardWrite = Promise.reject(error);
  }

  const writeResult = clipboardWrite.then(
    () => ({ kind: "write-succeeded" as const }),
    () => ({ kind: "write-failed" as const }),
  );

  return Promise.race([pngResult, writeResult]).then(async (firstResult) => {
    if (firstResult.kind === "write-failed") {
      const error = new ReplayScreenshotClipboardError();
      onClipboardWriteFailure?.();
      throw error;
    }

    const finalPngResult =
      firstResult.kind === "png-ready" || firstResult.kind === "png-failed"
        ? firstResult
        : await pngResult;
    if (finalPngResult.kind === "png-failed") {
      if (finalPngResult.error instanceof ReplayScreenshotAssetError) {
        throw finalPngResult.error;
      }
      throw new ReplayScreenshotClipboardError();
    }

    const finalWriteResult =
      firstResult.kind === "write-succeeded" ? firstResult : await writeResult;
    if (finalWriteResult.kind === "write-failed") {
      const error = new ReplayScreenshotClipboardError();
      onClipboardWriteFailure?.();
      throw error;
    }
  });
}

export async function captureReplayScreenshot(
  stage: HTMLElement,
  stageRoot: HTMLElement,
  iframe: HTMLIFrameElement,
  signal?: AbortSignal,
  options: { assetCredentials?: RequestCredentials } = {},
): Promise<Blob> {
  const replayWindow = iframe.contentWindow;
  const replayDocument = iframe.contentDocument;
  if (
    !replayWindow ||
    !replayDocument?.documentElement ||
    !stage.isConnected ||
    !stage.contains(stageRoot) ||
    !stageRoot.contains(iframe)
  ) {
    throw new Error("Replay frame is unavailable");
  }

  const assertCaptureAvailable = () => {
    if (
      signal?.aborted ||
      !stage.isConnected ||
      !stage.contains(stageRoot) ||
      !stageRoot.contains(iframe) ||
      iframe.contentWindow !== replayWindow ||
      iframe.contentDocument !== replayDocument
    ) {
      throw new Error("Replay frame is no longer available");
    }
  };
  const captureId = `replay${crypto.randomUUID().replace(/-/g, "")}`;
  const screenshotBudget = { bytes: 0 };
  const previousStageFrameMarker = iframe.getAttribute(
    REPLAY_SCREENSHOT_MARKER,
  );
  const stageFrameMarker = `${captureId}-stage-frame`;
  let failureReason:
    | "captureSetup"
    | "replayRender"
    | "stageRender"
    | "pngEncode" = "captureSetup";
  try {
    await assertReplayFontsReady(replayDocument, signal);
    assertCaptureAvailable();
    const replayAssets = await assertRemoteImagesCapturable(
      replayDocument,
      signal,
      options.assetCredentials,
    );
    assertCaptureAvailable();
    await waitForReplayPaint(signal);
    assertCaptureAvailable();

    const width = replayWindow.innerWidth;
    const height = replayWindow.innerHeight;
    assertScreenshotDimensions(width, height);

    iframe.setAttribute(REPLAY_SCREENSHOT_MARKER, stageFrameMarker);
    const { default: html2canvas } = await import("html2canvas-pro");
    assertCaptureAvailable();
    failureReason = "replayRender";
    const replayImageUrl = await captureReplayDocument(
      replayDocument,
      replayAssets,
      html2canvas,
      `${captureId}-replay`,
      screenshotBudget,
      new Set(),
      assertCaptureAvailable,
    );
    assertCaptureAvailable();

    failureReason = "stageRender";
    const canvas = await html2canvas(stageRoot, {
      allowTaint: false,
      backgroundColor:
        stage.ownerDocument.defaultView?.getComputedStyle(stage)
          .backgroundColor ?? null,
      height,
      logging: false,
      scale: 1,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: width,
      onclone: (_clonedDocument, clonedStageRoot) => {
        assertCaptureAvailable();
        const clonedFrame = clonedStageRoot.querySelector(
          `iframe[${REPLAY_SCREENSHOT_MARKER}="${stageFrameMarker}"]`,
        );
        if (!clonedFrame) {
          throw new ReplayScreenshotAssetError("cloneStageFrame");
        }
        const image = clonedStageRoot.ownerDocument.createElement("img");
        image.alt = "";
        image.src = replayImageUrl;
        const frameStyles = window.getComputedStyle(iframe);
        for (let index = 0; index < frameStyles.length; index += 1) {
          const property = frameStyles.item(index);
          image.style.setProperty(
            property,
            frameStyles.getPropertyValue(property),
            frameStyles.getPropertyPriority(property),
          );
        }
        image.style.setProperty("object-fit", "fill", "important");
        clonedFrame.replaceWith(image);
        clonedStageRoot.style.position = "fixed";
        clonedStageRoot.style.left = "0";
        clonedStageRoot.style.top = "0";
        clonedStageRoot.style.width = `${width}px`;
        clonedStageRoot.style.height = `${height}px`;
        clonedStageRoot.style.transform = "none";
        clonedStageRoot.style.transformOrigin = "top left";
        clonedStageRoot.style.setProperty("--an-replay-cursor-scale", "1");
      },
    });
    assertCaptureAvailable();
    assertScreenshotDimensions(canvas.width, canvas.height);
    failureReason = "pngEncode";
    const blob = await canvasToBlob(canvas);
    assertCaptureAvailable();
    return blob;
  } catch (error) {
    if (error instanceof ReplayScreenshotAssetError) throw error;
    throw new ReplayScreenshotCaptureError(
      rendererFailureReason(error, failureReason),
    );
  } finally {
    if (previousStageFrameMarker === null) {
      iframe.removeAttribute(REPLAY_SCREENSHOT_MARKER);
    } else {
      iframe.setAttribute(REPLAY_SCREENSHOT_MARKER, previousStageFrameMarker);
    }
  }
}

export function downloadReplayScreenshotBlob(
  blob: Blob,
  filename: string,
): void {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = downloadUrl;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

export async function downloadReplayScreenshot(
  stage: HTMLElement,
  stageRoot: HTMLElement,
  iframe: HTMLIFrameElement,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  const screenshot = await captureReplayScreenshot(
    stage,
    stageRoot,
    iframe,
    signal,
  );
  downloadReplayScreenshotBlob(screenshot, filename);
}

function assertScreenshotDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_SCREENSHOT_DIMENSION ||
    height > MAX_SCREENSHOT_DIMENSION ||
    width * height > MAX_SCREENSHOT_PIXELS
  ) {
    throw new ReplayScreenshotAssetError();
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Replay screenshot could not be encoded"));
    }, "image/png");
  });
}

async function canvasToScreenshotUrl(
  canvas: HTMLCanvasElement,
  budget: { bytes: number },
): Promise<string> {
  assertScreenshotDimensions(canvas.width, canvas.height);
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/png");
  } catch {
    throw new ReplayScreenshotAssetError();
  }
  if (
    !dataUrl.startsWith("data:image/png") ||
    budget.bytes + dataUrl.length > MAX_INLINE_ASSET_BYTES
  ) {
    throw new ReplayScreenshotAssetError();
  }
  budget.bytes += dataUrl.length;
  return dataUrl;
}

async function captureReplayDocument(
  replayDocument: Document,
  assets: ReplayScreenshotAssets,
  html2canvas: Html2Canvas,
  captureId: string,
  budget: { bytes: number },
  ancestors: Set<Document>,
  assertCaptureAvailable: () => void,
): Promise<string> {
  if (
    ancestors.has(replayDocument) ||
    ancestors.size >= MAX_REPLAY_IFRAME_DEPTH
  ) {
    throw new ReplayScreenshotAssetError();
  }
  ancestors.add(replayDocument);
  const childScreenshots = new Map<HTMLIFrameElement, string>();
  try {
    // html2canvas adds a hidden iframe to the document before calling onclone.
    const originalElements = renderedElements(replayDocument);
    const replayFrames = originalElements.filter(
      (element): element is HTMLIFrameElement => element.tagName === "IFRAME",
    );
    for (const frame of replayFrames) {
      if (!isElementRendered(frame, replayDocument)) continue;
      const childDocument = frame.contentDocument;
      if (!childDocument?.documentElement) {
        throw new ReplayScreenshotAssetError();
      }
      childScreenshots.set(
        frame,
        await captureReplayDocument(
          childDocument,
          assets,
          html2canvas,
          `${captureId}-${childScreenshots.size}`,
          budget,
          ancestors,
          assertCaptureAvailable,
        ),
      );
      if (frame.contentDocument !== childDocument) {
        throw new Error("Replay frame is no longer available");
      }
    }

    assertCaptureAvailable();
    const replayWindow = replayDocument.defaultView;
    if (!replayWindow || !replayDocument.documentElement) {
      throw new Error("Replay frame is no longer available");
    }
    const width = replayWindow.innerWidth;
    const height = replayWindow.innerHeight;
    assertScreenshotDimensions(width, height);
    const restoreMarkers = markReplayElements([replayDocument], captureId);
    try {
      const canvas = await html2canvas(
        replayDocument.documentElement as HTMLElement,
        {
          allowTaint: false,
          backgroundColor: null,
          height,
          logging: false,
          scale: 1,
          scrollX: replayWindow.scrollX,
          scrollY: replayWindow.scrollY,
          useCORS: true,
          width,
          windowHeight: height,
          windowWidth: width,
          onclone: (clonedDocument) => {
            assertCaptureAvailable();
            inlineReplayAssets(
              replayDocument,
              clonedDocument,
              assets,
              captureId,
              childScreenshots,
              originalElements,
            );
          },
        },
      );
      assertCaptureAvailable();
      return await canvasToScreenshotUrl(canvas, budget);
    } finally {
      restoreMarkers();
    }
  } finally {
    ancestors.delete(replayDocument);
  }
}
