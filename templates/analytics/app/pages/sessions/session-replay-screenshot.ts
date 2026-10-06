export class ReplayScreenshotAssetError extends Error {
  constructor() {
    super("Replay contains media or images that cannot be captured safely");
    this.name = "ReplayScreenshotAssetError";
  }
}

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
        const source = frame.getAttribute("src");
        if (source && new URL(source, current.baseURI).protocol !== "about:") {
          throw new ReplayScreenshotAssetError();
        }
        continue;
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
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin !== window.location.origin
    ) {
      urls.add(url.href);
    }
  };
  const addCssUrls = (value: string, baseURI: string) => {
    if (!value) return;
    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
      addUrl(match[1], baseURI);
    }
  };

  for (const current of documents) {
    for (const image of current.querySelectorAll<HTMLImageElement>("img")) {
      const source = image.currentSrc || image.src;
      if (source) addUrl(source, current.baseURI);
    }

    for (const image of current.querySelectorAll<SVGImageElement>(
      "svg image",
    )) {
      const source =
        image.getAttribute("href") ||
        image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (source) addUrl(source, current.baseURI);
    }

    for (const video of current.querySelectorAll<HTMLVideoElement>(
      "video[poster]",
    )) {
      if (video.poster) addUrl(video.poster, current.baseURI);
    }

    for (const element of current.querySelectorAll<Element>("*")) {
      const view = current.defaultView ?? window;
      const styles = view.getComputedStyle(element);
      addCssUrls(styles.backgroundImage, current.baseURI);
      addCssUrls(styles.maskImage, current.baseURI);

      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyles = view.getComputedStyle(element, pseudo);
        addCssUrls(pseudoStyles.content, current.baseURI);
        addCssUrls(pseudoStyles.backgroundImage, current.baseURI);
        addCssUrls(pseudoStyles.maskImage, current.baseURI);
      }
    }
  }

  return [...urls];
}

export function crossOriginImageUrls(document: Document): string[] {
  return imageUrlsInDocuments(replayDocuments(document));
}

export async function assertRemoteImagesCapturable(
  document: Document,
): Promise<void> {
  const documents = replayDocuments(document);
  if (
    documents.some((current) =>
      Array.from(current.querySelectorAll<HTMLVideoElement>("video")).some(
        (video) =>
          video.currentSrc ||
          video.hasAttribute("src") ||
          video.srcObject ||
          video.querySelector("source[src]"),
      ),
    )
  ) {
    throw new ReplayScreenshotAssetError();
  }

  const urls = imageUrlsInDocuments(documents);
  const checks = await Promise.all(
    urls.map(async (url) => {
      let response: Response;
      try {
        response = await fetch(url, {
          cache: "force-cache",
          credentials: "omit",
          mode: "cors",
        });
      } catch {
        throw new ReplayScreenshotAssetError();
      }
      return (
        response.ok &&
        response.headers.get("content-type")?.startsWith("image/")
      );
    }),
  );

  if (checks.some((capturable) => !capturable)) {
    throw new ReplayScreenshotAssetError();
  }
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

  await replayDocument.fonts?.ready;
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
