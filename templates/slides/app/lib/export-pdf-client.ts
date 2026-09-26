import { appBasePath } from "@agent-native/core/client/api-path";
import {
  SLIDES_PDF_SIDECAR_MAX_JSON_BYTES,
  SLIDES_PDF_SIDECAR_NAMESPACE,
  type SlidesPdfSidecar,
  type SlidesPdfSidecarSlide,
} from "@shared/pdf-sidecar";

import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import { importExportModule } from "./dynamic-import";
import { sanitizeSlideUrl } from "./sanitize-slide-html";

export function imageProxyUrl(src: string, shareToken?: string): string {
  const params = new URLSearchParams({ url: src });
  if (shareToken) params.set("shareToken", shareToken);
  return `${appBasePath()}/api/image-proxy?${params.toString()}`;
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("PDF export cancelled");
  error.name = "AbortError";
  throw signal.reason ?? error;
}

async function decodeImage(
  image: HTMLImageElement,
  signal?: AbortSignal,
): Promise<void> {
  throwIfExportAborted(signal);
  if (typeof image.decode !== "function") return;
  await image.decode();
  throwIfExportAborted(signal);
}

async function decodeImageBestEffort(
  image: HTMLImageElement,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await decodeImage(image, signal);
  } catch (error) {
    throwIfExportAborted(signal);
    console.warn(
      `[export-pdf] image could not be decoded for export: ${image.currentSrc || image.src}`,
      error,
    );
  }
}

export async function preloadImagesWithCors(
  root: HTMLElement,
  signal?: AbortSignal,
  shareToken?: string,
): Promise<() => void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  const restores: Array<() => void> = [];

  try {
    await Promise.all(
      imgs.map(async (img) => {
        throwIfExportAborted(signal);
        const src = img.currentSrc || img.src;
        if (!src) return;
        if (src.startsWith("data:") || src.startsWith("blob:")) {
          await decodeImageBestEffort(img, signal);
          return;
        }
        let isCrossOrigin = false;
        try {
          isCrossOrigin =
            new URL(src, window.location.href).origin !==
            window.location.origin;
        } catch {
          isCrossOrigin = false;
        }
        if (!isCrossOrigin) {
          await decodeImageBestEffort(img, signal);
          return;
        }

        const originalCrossOrigin = img.getAttribute("crossorigin");
        const originalSrc = img.getAttribute("src");
        const restore = () => {
          if (originalCrossOrigin === null) img.removeAttribute("crossorigin");
          else img.setAttribute("crossorigin", originalCrossOrigin);
          if (originalSrc === null) img.removeAttribute("src");
          else img.setAttribute("src", originalSrc);
        };

        if (img.crossOrigin === "anonymous") {
          try {
            await decodeImage(img, signal);
            return;
          } catch {
            throwIfExportAborted(signal);
            // coercion-ok: a failed direct load is the signal to try the proxy,
            // and the proxy attempt below reports its own failure.
          }
        } else {
          img.crossOrigin = "anonymous";
          img.src = src;
          restores.push(restore);
          try {
            await decodeImage(img, signal);
            return;
          } catch {
            throwIfExportAborted(signal);
            // coercion-ok: same as above — this is the CORS probe, not the
            // final outcome.
          }
        }

        if (!restores.includes(restore)) restores.push(restore);
        img.crossOrigin = "anonymous";
        img.src = imageProxyUrl(src, shareToken);
        try {
          await decodeImage(img, signal);
        } catch (err) {
          throwIfExportAborted(signal);
          console.warn(
            `[export-pdf] image could not be loaded for export: ${src}`,
            err,
          );
        }
      }),
    );
  } catch (error) {
    for (const restore of restores) restore();
    throw error;
  }

  throwIfExportAborted(signal);

  return () => {
    for (const restore of restores) restore();
  };
}

export function findSlideExportSource(
  slideId: string,
  slideIndex: number,
  slideCount: number,
  root: ParentNode = document,
): HTMLElement {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      `[data-slide-canvas="${CSS.escape(slideId)}"]`,
    ),
  );
  if (candidates.length === 0) {
    throw new Error(
      `Slide ${slideIndex + 1} of ${slideCount} is not currently rendered. Open the slide sidebar and try again.`,
    );
  }

  return candidates.reduce((best, el) => {
    const elWidth = el.getBoundingClientRect().width;
    const bestWidth = best.getBoundingClientRect().width;
    if (elWidth !== bestWidth) return elWidth > bestWidth ? el : best;
    return el.offsetWidth > best.offsetWidth ? el : best;
  });
}

export type PdfExportSlide = {
  id: string;
  notes?: string;
} & Partial<SlidesPdfSidecarSlide>;

function exportStageHasPendingRenderers(stage: HTMLElement): boolean {
  const pendingImages = Array.from(
    stage.querySelectorAll<HTMLImageElement>("img"),
  ).some((image) => !image.complete);
  if (pendingImages) return true;

  const pendingMermaid = Array.from(
    stage.querySelectorAll<HTMLElement>("[data-mermaid-index]"),
  ).some((node) => {
    if (node.querySelector("[data-mermaid-index]")) return false;
    const state = node.dataset.mermaidState;
    if (state === "empty" || state === "error" || state === "ready") {
      return false;
    }
    return !node.querySelector("svg") && !node.textContent?.trim();
  });
  if (pendingMermaid) return true;

  return stage.querySelector('[data-excalidraw-renderer="pending"]') !== null;
}

function waitForExportFrame(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        throwIfExportAborted(signal);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

function waitForDocumentFonts(signal?: AbortSignal): Promise<void> {
  const ready = document.fonts?.ready;
  if (!ready) return Promise.resolve();
  if (!signal) return ready.then(() => undefined);

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      try {
        throwIfExportAborted(signal);
      } catch (error) {
        reject(error);
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });
    ready.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

async function exposeGoogleFontStylesheetsForPdf(
  signal?: AbortSignal,
): Promise<() => void> {
  const hrefs = new Set(
    Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        'link[rel~="stylesheet"][href]',
      ),
    )
      .map((link) => link.href)
      .filter((href) => {
        try {
          return (
            new URL(href, document.baseURI).hostname === "fonts.googleapis.com"
          );
        } catch {
          // coercion-ok: malformed hrefs are not Google-hosted stylesheets.
          return false;
        }
      }),
  );
  const styles: HTMLStyleElement[] = [];

  const cleanup = () => {
    for (const style of styles) style.remove();
  };

  try {
    await Promise.all(
      [...hrefs].map(async (href) => {
        try {
          throwIfExportAborted(signal);
          const response = await fetch(href, {
            credentials: "omit",
            mode: "cors",
            signal,
          });
          if (!response.ok) {
            throw new Error(`Font stylesheet returned ${response.status}`);
          }
          const cssText = await response.text();
          if (!cssText.includes("@font-face")) return;
          throwIfExportAborted(signal);

          const style = document.createElement("style");
          style.dataset.pdfExportFontFaces = "true";
          style.textContent = cssText;
          document.head.appendChild(style);
          styles.push(style);
        } catch (error) {
          throwIfExportAborted(signal);
          // coercion-ok: font CSS is an enhancement; the original exporter can
          console.warn(
            `[export-pdf] could not inline Google Font CSS for ${href}; the PDF may use fallback metrics`,
            error,
          );
        }
      }),
    );
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}

async function waitForExportStage(
  stage: HTMLElement,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    throwIfExportAborted(signal);
    if (!exportStageHasPendingRenderers(stage)) {
      await waitForExportFrame(signal);
      if (!exportStageHasPendingRenderers(stage)) {
        await waitForExportFrame(signal);
        if (!exportStageHasPendingRenderers(stage)) return;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error("PDF export renderers did not become ready");
    }
    await waitForExportFrame(signal);
  }
}

function encodeSidecar(sidecar: SlidesPdfSidecar): string | undefined {
  const bytes = new TextEncoder().encode(JSON.stringify(sidecar));
  if (bytes.length > SLIDES_PDF_SIDECAR_MAX_JSON_BYTES) {
    console.warn(
      `[export-pdf] deck source is ${bytes.length} bytes, over the ${SLIDES_PDF_SIDECAR_MAX_JSON_BYTES}-byte sidecar cap — exporting without it. Re-importing this PDF will reconstruct layers from the page content instead of restoring the original slides.`,
    );
    return undefined;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const WIN_ANSI_HIGH = new Set(
  "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178",
);

function isWinAnsiEncodable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0xff) continue;
    if (WIN_ANSI_HIGH.has(char)) continue;
    return false;
  }
  return true;
}

function drawSelectableTextLayer(
  pdf: import("jspdf").jsPDF,
  source: HTMLElement,
  dims: { width: number; height: number },
): void {
  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return;

  const positionScale = dims.width / sourceRect.width;
  const fontScale = dims.width / (source.clientWidth || sourceRect.width);

  const pointsPerUnit = pdf.internal.scaleFactor;

  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const exportStage = source.closest("[data-pdf-export-stage]");
  pdf.setTextColor(0, 0, 0);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue;
    if (!raw?.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const hiddenAncestor = parent.closest('[aria-hidden="true"]');
    if (hiddenAncestor && hiddenAncestor !== exportStage) continue;

    const style = window.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (style.opacity === "0") continue;
    const fontSize = parseFloat(style.fontSize) * fontScale * pointsPerUnit;
    if (!Number.isFinite(fontSize) || fontSize <= 0) continue;

    pdf.setFontSize(fontSize);
    for (const line of splitNodeIntoRenderedLines(node, parent, range)) {
      const text = line.text.replace(/\s+/g, " ");
      if (!text.trim() || !isWinAnsiEncodable(text)) continue;
      pdf.text(
        text,
        (line.rect.left - sourceRect.left) * positionScale,
        (line.rect.top - sourceRect.top) * positionScale,
        {
          baseline: "top",
          renderingMode: "invisible",
          ...(line.wrapWithin === undefined
            ? {}
            : { maxWidth: line.wrapWithin * positionScale }),
        },
      );
    }
  }
}

function drawLinkAnnotations(
  pdf: import("jspdf").jsPDF,
  source: HTMLElement,
  dims: { width: number; height: number },
): void {
  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return;

  const positionScale = dims.width / sourceRect.width;
  for (const link of source.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const safeHref = sanitizeSlideUrl(
      link.getAttribute("href") ?? undefined,
      "link",
    );
    if (!safeHref) continue;

    let url: string;
    try {
      url = new URL(safeHref, window.location.href).href;
    } catch {
      continue;
    }

    const rects = Array.from(link.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const measuredRects = rects.length ? rects : [link.getBoundingClientRect()];
    for (const rect of measuredRects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const left = Math.max(rect.left, sourceRect.left);
      const top = Math.max(rect.top, sourceRect.top);
      const right = Math.min(
        rect.left + rect.width,
        sourceRect.left + sourceRect.width,
      );
      const bottom = Math.min(
        rect.top + rect.height,
        sourceRect.top + sourceRect.height,
      );
      if (right <= left || bottom <= top) continue;
      pdf.link(
        (left - sourceRect.left) * positionScale,
        (top - sourceRect.top) * positionScale,
        (right - left) * positionScale,
        (bottom - top) * positionScale,
        { url },
      );
    }
  }
}

function splitNodeIntoRenderedLines(
  node: Node,
  parent: HTMLElement,
  range: Range,
): { text: string; rect: DOMRect; wrapWithin?: number }[] {
  const value = node.nodeValue ?? "";
  range.selectNodeContents(node);
  const lineRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (lineRects.length === 0) {
    const union = range.getBoundingClientRect();
    const box =
      union.width > 0 && union.height > 0
        ? union
        : parent.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return [];
    return [{ text: value, rect: box, wrapWithin: box.width }];
  }
  if (lineRects.length === 1) {
    return [{ text: value, rect: lineRects[0] }];
  }

  const lines: { text: string; rect: DOMRect; wrapWithin?: number }[] = [];
  let start = 0;
  for (let lineIndex = 0; lineIndex < lineRects.length; lineIndex++) {
    const rect = lineRects[lineIndex];
    if (lineIndex === lineRects.length - 1) {
      lines.push({ text: value.slice(start), rect });
      break;
    }
    let end = start;
    while (end < value.length) {
      range.setStart(node, start);
      range.setEnd(node, end + 1);
      if (range.getClientRects().length > 1) break;
      end += 1;
    }
    lines.push({ text: value.slice(start, end), rect });
    start = end;
  }
  range.selectNodeContents(node);
  return lines;
}

export async function exportDeckAsPdf(
  deckTitle: string,
  slides: PdfExportSlide[],
  aspectRatio?: AspectRatio,
  options: { signal?: AbortSignal; shareToken?: string } = {},
): Promise<void> {
  const { signal, shareToken } = options;
  throwIfExportAborted(signal);
  const [{ domToJpeg }, { jsPDF }] = await Promise.all([
    importExportModule(() => import("modern-screenshot")),
    importExportModule(() => import("jspdf")),
  ]);
  throwIfExportAborted(signal);

  await waitForDocumentFonts(signal);
  throwIfExportAborted(signal);

  const dims = getAspectRatioDims(aspectRatio) ?? getAspectRatioDims(undefined);
  const orientation = dims.width >= dims.height ? "landscape" : "portrait";

  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [dims.width, dims.height],
  });

  const exportStage = document.querySelector<HTMLElement>(
    "[data-pdf-export-stage]",
  );
  if (exportStage) await waitForExportStage(exportStage, signal);
  const restoreFontStyles = await exposeGoogleFontStylesheetsForPdf(signal);
  try {
    await waitForDocumentFonts(signal);
    throwIfExportAborted(signal);
    for (let i = 0; i < slides.length; i++) {
      throwIfExportAborted(signal);
      const slideId = slides[i].id;
      const source = findSlideExportSource(
        slideId,
        i,
        slides.length,
        exportStage ?? document,
      );

      const restoreImages = await preloadImagesWithCors(
        source,
        signal,
        shareToken,
      );
      if (exportStage) {
        await waitForExportFrame(signal);
        await waitForExportFrame(signal);
      }

      let dataUrl: string;
      try {
        throwIfExportAborted(signal);
        dataUrl = await domToJpeg(source, {
          width: dims.width,
          height: dims.height,
          scale: 2, // 2x for crisp text
          // guard:allow-raw-color — a PDF page has no theme to follow.
          backgroundColor: "#000000",
          quality: 0.92,
          // cookie, so omitting credentials would 401 exactly the images this
          fetch: {
            requestInit: {
              cache: "no-cache",
              mode: "cors",
              credentials: "same-origin",
            },
          },
        });
        throwIfExportAborted(signal);
      } finally {
        restoreImages();
      }

      throwIfExportAborted(signal);
      if (i > 0) pdf.addPage([dims.width, dims.height], orientation);
      pdf.addImage(dataUrl, "JPEG", 0, 0, dims.width, dims.height);
      drawSelectableTextLayer(pdf, source, dims);
      drawLinkAnnotations(pdf, source, dims);
    }
  } finally {
    restoreFontStyles();
  }

  const sidecar = encodeSidecar({
    v: 1,
    title: deckTitle,
    ...(aspectRatio ? { aspectRatio } : {}),
    slides: slides.map((slide) => ({
      content: slide.content ?? "",
      ...(slide.layout ? { layout: slide.layout } : {}),
      ...(slide.background ? { background: slide.background } : {}),
      ...(slide.imageUrl ? { imageUrl: slide.imageUrl } : {}),
      ...(slide.excalidrawData ? { excalidrawData: slide.excalidrawData } : {}),
      ...(slide.transition ? { transition: slide.transition } : {}),
      ...(slide.splitByParagraph ? { splitByParagraph: true } : {}),
      ...(slide.skipped ? { skipped: true } : {}),
      ...(slide.animations?.length ? { animations: slide.animations } : {}),
    })),
  });
  if (sidecar) pdf.addMetadata(sidecar, SLIDES_PDF_SIDECAR_NAMESPACE);

  throwIfExportAborted(signal);
  const safeName = deckTitle.replace(/[^a-zA-Z0-9]/g, "-");
  const blob = pdf.output("blob");
  throwIfExportAborted(signal);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
