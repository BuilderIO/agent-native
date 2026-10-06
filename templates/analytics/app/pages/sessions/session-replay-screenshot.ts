export class ReplayScreenshotAssetError extends Error {
  constructor() {
    super("Replay contains media or images that cannot be captured safely");
    this.name = "ReplayScreenshotAssetError";
  }
}

const REMOTE_IMAGE_PREFLIGHT_TIMEOUT_MS = 8_000;
const REMOTE_IMAGE_PREFLIGHT_CONCURRENCY = 4;
const REPLAY_FONT_TIMEOUT_MS = 8_000;

type ReplayImageResource = { document: Document; url: string };

function isElementRendered(element: Element, document: Document): boolean {
  const view = document.defaultView;
  if (!view) return true;

  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const styles = view.getComputedStyle(current);
    if (
      styles.display === "none" ||
      styles.visibility === "hidden" ||
      styles.visibility === "collapse" ||
      styles.contentVisibility === "hidden" ||
      (styles.opacity !== "" && Number(styles.opacity) === 0)
    ) {
      return false;
    }
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
  const visit = (current: Document) => {
    if (visited.has(current)) return;
    visited.add(current);
    documents.push(current);

    for (const frame of current.querySelectorAll<HTMLIFrameElement>("iframe")) {
      if (!isElementRendered(frame, current)) continue;
      const child = frame.contentDocument;
      if (!child?.documentElement) {
        throw new ReplayScreenshotAssetError();
      }
      visit(child);
    }
  };

  visit(document);
  return documents;
}

function imageResourcesInDocuments(
  documents: Document[],
): ReplayImageResource[] {
  const urlsByDocument = new Map<Document, Set<string>>();
  const addUrl = (value: string, baseURI: string, document: Document) => {
    const normalizedValue = value.trim();
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
    }
  };
  const addCssUrls = (value: string, baseURI: string, document: Document) => {
    if (!value) return;
    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
      addUrl(match[1], baseURI, document);
    }

    const imageSetFunction = /(?:-webkit-)?image-set\s*\(/gi;
    for (const match of value.matchAll(imageSetFunction)) {
      const contentStart = (match.index ?? 0) + match[0].length;
      let depth = 1;
      let quote = "";
      let contentEnd = contentStart;
      for (; contentEnd < value.length; contentEnd += 1) {
        const character = value[contentEnd];
        if (character === "\\") {
          contentEnd += 1;
          continue;
        }
        if (quote) {
          if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "(") {
          depth += 1;
        } else if (character === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      const candidates = value.slice(contentStart, contentEnd);
      const candidateStart = /^\s*(["'])(.*?)\1/s;
      for (const candidate of candidates.split(/,(?![^()]*\))/)) {
        const quotedUrl = candidate.match(candidateStart)?.[2];
        if (quotedUrl) {
          addUrl(quotedUrl.replace(/\\(.)/g, "$1"), baseURI, document);
        }
      }
    }
  };

  for (const current of documents) {
    if (
      [...current.querySelectorAll("object, embed")].some((element) =>
        isElementRendered(element, current),
      )
    ) {
      throw new ReplayScreenshotAssetError();
    }

    for (const image of current.querySelectorAll<HTMLImageElement>("img")) {
      if (!isElementRendered(image, current)) continue;
      const source = image.currentSrc || image.src;
      if (source) addUrl(source, current.baseURI, current);
    }

    for (const image of current.querySelectorAll<HTMLInputElement>(
      'input[type="image"]',
    )) {
      if (!isElementRendered(image, current)) continue;
      if (image.src) addUrl(image.src, current.baseURI, current);
    }

    for (const image of current.querySelectorAll<SVGElement>(
      "svg image, svg use, svg feImage",
    )) {
      if (!isElementRendered(image, current)) continue;
      const source =
        image.getAttribute("href") ||
        image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (
        source &&
        !source.trim().startsWith("#") &&
        !source.trim().startsWith("data:")
      ) {
        throw new ReplayScreenshotAssetError();
      }
    }

    for (const video of current.querySelectorAll<HTMLVideoElement>("video")) {
      if (!isElementRendered(video, current)) continue;
      if (
        video.poster ||
        video.currentSrc ||
        video.hasAttribute("src") ||
        video.srcObject ||
        video.querySelector("source[src]")
      ) {
        throw new ReplayScreenshotAssetError();
      }
    }

    const styledElements = [
      current.documentElement,
      ...current.querySelectorAll<Element>("*"),
    ];
    for (const element of styledElements) {
      if (!isElementRendered(element, current)) continue;
      const view = current.defaultView ?? window;
      const styles = view.getComputedStyle(element);
      addCssUrls(styles.backgroundImage, current.baseURI, current);
      addCssUrls(styles.listStyleImage, current.baseURI, current);
      addCssUrls(styles.maskImage, current.baseURI, current);
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
        addCssUrls(pseudoStyles.maskImage, current.baseURI, current);
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

function imageUrlsInDocuments(documents: Document[]): string[] {
  return [
    ...new Set(imageResourcesInDocuments(documents).map(({ url }) => url)),
  ];
}

export function crossOriginImageUrls(document: Document): string[] {
  return imageUrlsInDocuments(replayDocuments(document)).filter(
    (url) => new URL(url).origin !== window.location.origin,
  );
}

export async function assertRemoteImagesCapturable(
  document: Document,
): Promise<void> {
  const documents = replayDocuments(document);
  const resources = imageResourcesInDocuments(documents);
  const controller = new AbortController();
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
      const image = resource.document.createElement("img");
      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            image.onload = null;
            image.onerror = null;
            controller.signal.removeEventListener("abort", abort);
          };
          const succeed = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          };
          const failImage = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new ReplayScreenshotAssetError());
          };
          const abort = () => {
            image.removeAttribute("src");
            failImage();
          };

          image.crossOrigin = "anonymous";
          image.onload = () => {
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              succeed();
            } else {
              failImage();
            }
          };
          image.onerror = failImage;
          controller.signal.addEventListener("abort", abort, { once: true });
          if (controller.signal.aborted) {
            abort();
            return;
          }
          image.src = resource.url;
        });
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
  }

  if (!allCapturable || controller.signal.aborted) {
    throw new ReplayScreenshotAssetError();
  }
}

async function assertDocumentFontsReady(document: Document): Promise<void> {
  const fontSet = document.fonts;
  if (!fontSet?.ready) return;

  let timeoutId: number | undefined;
  try {
    await Promise.race([
      fontSet.ready,
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new ReplayScreenshotAssetError()),
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
): Promise<void> {
  await Promise.all(replayDocuments(document).map(assertDocumentFontsReady));
}

export async function downloadReplayScreenshot(
  stage: HTMLElement,
  iframe: HTMLIFrameElement,
  filename: string,
): Promise<void> {
  const replayWindow = iframe.contentWindow;
  const replayDocument = iframe.contentDocument;
  if (!replayWindow || !replayDocument?.documentElement || !stage.isConnected) {
    throw new Error("Replay frame is unavailable");
  }

  await assertReplayFontsReady(replayDocument);
  await assertRemoteImagesCapturable(replayDocument);
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve()),
    );
  });

  const { default: html2canvas } = await import("html2canvas");
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) throw new Error("Replay frame has no size");

  const canvas = await html2canvas(stage, {
    allowTaint: false,
    backgroundColor: null,
    height,
    logging: false,
    scale: 1,
    scrollX: 0,
    scrollY: 0,
    useCORS: true,
    width,
    windowHeight: window.innerHeight,
    windowWidth: window.innerWidth,
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Replay screenshot could not be encoded"));
    }, "image/png");
  });

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = downloadUrl;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
