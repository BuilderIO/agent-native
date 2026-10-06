export class ReplayScreenshotAssetError extends Error {
  constructor() {
    super("Replay contains media or images that cannot be captured safely");
    this.name = "ReplayScreenshotAssetError";
  }
}

const REMOTE_IMAGE_PREFLIGHT_TIMEOUT_MS = 8_000;
const REMOTE_IMAGE_PREFLIGHT_CONCURRENCY = 4;
const REPLAY_FONT_TIMEOUT_MS = 8_000;

function replayDocuments(document: Document): Document[] {
  const documents: Document[] = [];
  const visited = new Set<Document>();
  const visit = (current: Document) => {
    if (visited.has(current)) return;
    visited.add(current);
    documents.push(current);

    for (const frame of current.querySelectorAll<HTMLIFrameElement>("iframe")) {
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

function imageUrlsInDocuments(documents: Document[]): string[] {
  const urls = new Set<string>();
  const addUrl = (value: string, baseURI: string) => {
    const url = new URL(value, baseURI);
    if (url.protocol === "https:" || url.protocol === "http:") {
      urls.add(url.href);
    }
  };
  const addCssUrls = (value: string, baseURI: string) => {
    if (!value) return;
    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
      addUrl(match[1], baseURI);
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
        if (quotedUrl) addUrl(quotedUrl.replace(/\\(.)/g, "$1"), baseURI);
      }
    }
  };

  for (const current of documents) {
    if (current.querySelector("object, embed")) {
      throw new ReplayScreenshotAssetError();
    }

    for (const image of current.querySelectorAll<HTMLImageElement>("img")) {
      const source = image.currentSrc || image.src;
      if (source) addUrl(source, current.baseURI);
    }

    for (const image of current.querySelectorAll<HTMLInputElement>(
      'input[type="image"]',
    )) {
      if (image.src) addUrl(image.src, current.baseURI);
    }

    for (const image of current.querySelectorAll<SVGImageElement>(
      "svg image, svg use, svg feImage",
    )) {
      const source =
        image.getAttribute("href") ||
        image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (source) addUrl(source, current.baseURI);
    }

    for (const video of current.querySelectorAll<HTMLVideoElement>("video")) {
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
      const view = current.defaultView ?? window;
      const styles = view.getComputedStyle(element);
      addCssUrls(styles.backgroundImage, current.baseURI);
      addCssUrls(styles.listStyleImage, current.baseURI);
      addCssUrls(styles.maskImage, current.baseURI);
      if (styles.borderImageSource && styles.borderImageSource !== "none") {
        throw new ReplayScreenshotAssetError();
      }

      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyles = view.getComputedStyle(element, pseudo);
        addCssUrls(pseudoStyles.content, current.baseURI);
        addCssUrls(pseudoStyles.backgroundImage, current.baseURI);
        addCssUrls(pseudoStyles.listStyleImage, current.baseURI);
        addCssUrls(pseudoStyles.maskImage, current.baseURI);
        if (
          pseudoStyles.borderImageSource &&
          pseudoStyles.borderImageSource !== "none"
        ) {
          throw new ReplayScreenshotAssetError();
        }
      }
    }
  }

  return [...urls];
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
  const urls = imageUrlsInDocuments(documents);
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
    while (allCapturable && nextUrlIndex < urls.length) {
      const url = urls[nextUrlIndex++];
      let response: Response | undefined;
      try {
        const sameOrigin = new URL(url).origin === window.location.origin;
        response = await fetch(url, {
          cache: "force-cache",
          credentials: sameOrigin ? "same-origin" : "omit",
          mode: "cors",
          signal: controller.signal,
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("image/") ||
          (sameOrigin &&
            (response.redirected ||
              (response.url &&
                new URL(response.url).origin !== window.location.origin)))
        ) {
          fail();
        }
      } catch {
        fail();
      } finally {
        try {
          await response?.body?.cancel();
        } catch {
          fail();
        }
      }
    }
  };
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(REMOTE_IMAGE_PREFLIGHT_CONCURRENCY, urls.length) },
        () => checkNextUrl(),
      ),
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!allCapturable) {
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
