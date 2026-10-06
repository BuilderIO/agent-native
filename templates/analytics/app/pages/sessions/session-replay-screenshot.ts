export class ReplayScreenshotAssetError extends Error {
  constructor() {
    super("Replay contains cross-origin images that cannot be captured safely");
    this.name = "ReplayScreenshotAssetError";
  }
}

function crossOriginImageUrls(document: Document): string[] {
  const urls = new Set<string>();
  const addUrl = (value: string) => {
    const url = new URL(value, document.baseURI);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin !== window.location.origin
    ) {
      urls.add(url.href);
    }
  };
  const addCssUrls = (value: string) => {
    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      addUrl(match[1]);
    }
  };

  for (const image of document.images) {
    const source = image.currentSrc || image.src;
    if (source) addUrl(source);
  }

  for (const video of document.querySelectorAll<HTMLVideoElement>(
    "video[poster]",
  )) {
    if (video.poster) addUrl(video.poster);
  }

  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    const styles = window.getComputedStyle(element);
    addCssUrls(styles.backgroundImage);
    addCssUrls(styles.maskImage);
  }

  return [...urls];
}

async function assertRemoteImagesCapturable(document: Document): Promise<void> {
  const urls = crossOriginImageUrls(document);
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
