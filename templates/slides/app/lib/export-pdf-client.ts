/**
 * Client-side PDF export. Renders each slide element to a JPEG via
 * modern-screenshot, then assembles them into a PDF at the deck's aspect
 * ratio.
 *
 * Caller passes the ordered slide IDs from the deck and we look up each
 * slide's [data-slide-canvas="<id>"] element in the DOM (rendered by
 * SlideRenderer/SlideInner). Sidebar thumbnails and the active editor
 * canvas both carry that attribute — we de-dupe per id and prefer the
 * largest rendered element so a thumbnail's transform: scale(0.25)
 * doesn't shrink the captured pixels.
 */
import { appBasePath } from "@agent-native/core/client/api-path";
import {
  SLIDES_PDF_SIDECAR_MAX_JSON_BYTES,
  SLIDES_PDF_SIDECAR_NAMESPACE,
  type SlidesPdfSidecar,
  type SlidesPdfSidecarSlide,
} from "@shared/pdf-sidecar";

import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import { importExportModule } from "./dynamic-import";

/** Same-origin URL that re-serves a remote image, bypassing its missing CORS. */
export function imageProxyUrl(src: string): string {
  return `${appBasePath()}/api/image-proxy?url=${encodeURIComponent(src)}`;
}

/**
 * Cross-origin <img> elements without an explicit `crossOrigin="anonymous"`
 * attribute taint the canvas when rasterized via <foreignObject>, producing
 * a blank rect for the entire image. The browser will not retroactively
 * apply CORS to an already-decoded image — we have to force a re-fetch by
 * setting the attribute and re-assigning the same src. This is the root
 * cause of the "blank images in exported PDF" bug Rochkind reported.
 */
export async function preloadImagesWithCors(
  root: HTMLElement,
): Promise<() => void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  // The slide DOM is the live editor canvas. Anything rewritten here would
  // otherwise be picked up by the next save and persisted into the deck, so
  // every mutation is recorded and undone once the capture is done.
  const restores: Array<() => void> = [];

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
      let isCrossOrigin = false;
      try {
        isCrossOrigin =
          new URL(src, window.location.href).origin !== window.location.origin;
      } catch {
        isCrossOrigin = false;
      }
      if (!isCrossOrigin) return;

      const originalCrossOrigin = img.getAttribute("crossorigin");
      const originalSrc = img.getAttribute("src");
      const restore = () => {
        if (originalCrossOrigin === null) img.removeAttribute("crossorigin");
        else img.setAttribute("crossorigin", originalCrossOrigin);
        if (originalSrc === null) img.removeAttribute("src");
        else img.setAttribute("src", originalSrc);
      };

      if (img.crossOrigin === "anonymous") {
        // Already CORS-enabled; just make sure it's decoded.
        try {
          await img.decode();
          return;
        } catch {
          // coercion-ok: a failed direct load is the signal to try the proxy,
          // and the proxy attempt below reports its own failure.
        }
      } else {
        img.crossOrigin = "anonymous";
        // Re-set src to retrigger the load with the new CORS attribute.
        img.src = src;
        restores.push(restore);
        try {
          await img.decode();
          return;
        } catch {
          // coercion-ok: same as above — this is the CORS probe, not the
          // final outcome.
        }
      }

      // The host does not send Access-Control-Allow-Origin, and no client-side
      // flag can override that. Re-serve the image from our own origin so the
      // canvas stays clean instead of rasterizing a blank rect.
      if (!restores.includes(restore)) restores.push(restore);
      img.crossOrigin = "anonymous";
      img.src = imageProxyUrl(src);
      try {
        await img.decode();
      } catch (err) {
        console.warn(
          `[export-pdf] image could not be loaded for export: ${src}`,
          err,
        );
      }
    }),
  );

  return () => {
    for (const restore of restores) restore();
  };
}

export function findSlideExportSource(
  slideId: string,
  slideIndex: number,
  slideCount: number,
): HTMLElement {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-slide-canvas="${CSS.escape(slideId)}"]`,
    ),
  );
  // Don't silently drop missing slides — a collapsed sidebar (mobile
  // default) would otherwise produce a partial export with no warning.
  if (candidates.length === 0) {
    throw new Error(
      `Slide ${slideIndex + 1} of ${slideCount} is not currently rendered. Open the slide sidebar and try again.`,
    );
  }

  // A given slide can appear multiple times (sidebar thumbnail + active
  // editor canvas). Rank on the *rendered* width, not `offsetWidth`:
  // `offsetWidth` ignores CSS transforms, so a sidebar thumbnail shrunk by
  // `scale()` reports the same 960 as the canvas it mirrors. That tie left
  // the strict `>` below returning `candidates[0]` — document order, i.e.
  // the thumbnail — so exports captured the low-fidelity copy.
  // `getBoundingClientRect().width` sees through the transform and picks the
  // real canvas; `offsetWidth` only breaks a genuine rendered-width tie.
  return candidates.reduce((best, el) => {
    const elWidth = el.getBoundingClientRect().width;
    const bestWidth = best.getBoundingClientRect().width;
    if (elWidth !== bestWidth) return elWidth > bestWidth ? el : best;
    return el.offsetWidth > best.offsetWidth ? el : best;
  });
}

/** A deck slide as the exporter needs it: its id to find the rendered canvas, and the rest to carry. */
export type PdfExportSlide = { id: string } & Partial<SlidesPdfSidecarSlide>;

/**
 * Base64 of the UTF-8 JSON, chunked: `String.fromCharCode(...bytes)` on a
 * multi-megabyte deck blows the argument limit and throws before any of this
 * reaches the PDF.
 */
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

/**
 * CP1252's 0x80–0x9F block — the only characters above Latin-1 that jsPDF's
 * built-in fonts encode. Written as escapes on purpose: the literal form of this
 * set once smuggled a NUL into the source and made the whole file diff as binary.
 */
const WIN_ANSI_HIGH = new Set(
  "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178",
);

/**
 * Whether jsPDF's built-in fonts can write this run. A CJK or Arabic string
 * would be encoded as replacement bytes, and text that extracts as mojibake is
 * worse than text that is absent — the XMP sidecar carries the real content
 * either way.
 */
function isWinAnsiEncodable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0xff) continue;
    if (WIN_ANSI_HIGH.has(char)) continue;
    return false;
  }
  return true;
}

/**
 * Writes every rendered text node a second time as invisible PDF text sitting
 * over the page raster, the way a scanner's OCR layer does.
 *
 * The visible pixels stay the JPEG — this changes nothing about how the export
 * looks — but the page stops being a picture with no words in it: the text is
 * selectable, searchable and reachable by a screen reader, and `parsePdfFidelity`
 * can rebuild positioned text boxes from it if the PDF ever reaches us with its
 * XMP sidecar stripped.
 */
function drawSelectableTextLayer(
  pdf: import("jspdf").jsPDF,
  source: HTMLElement,
  dims: { width: number; height: number },
): void {
  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return;

  // Two different scales, because the two inputs live in different spaces.
  // Every slide canvas renders inside a `scale(var(--slide-scale))` wrapper, so
  // `getBoundingClientRect()` — which sees through transforms — gives positions
  // in visual pixels, while `getComputedStyle().fontSize` is untransformed CSS
  // pixels. Using one factor for both wrote headings at four times their size on
  // a sidebar thumbnail.
  const positionScale = dims.width / sourceRect.width;
  const fontScale = dims.width / (source.clientWidth || sourceRect.width);

  // jsPDF scales coordinates by the unit factor but passes `setFontSize`
  // straight through as PDF points, so a px-unit document needs the conversion
  // applied by hand or every run lands at 0.75x the size of the box it sits in.
  const pointsPerUnit = pdf.internal.scaleFactor;

  const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  pdf.setTextColor(0, 0, 0);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.replace(/\s+/g, " ").trim();
    if (!text || !isWinAnsiEncodable(text)) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    // Bullet glyphs the importer marks decorative would otherwise be extracted
    // as content and re-imported as their own text runs.
    if (parent.closest('[aria-hidden="true"]')) continue;

    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const style = window.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (style.opacity === "0") continue;
    const fontSize = parseFloat(style.fontSize) * fontScale * pointsPerUnit;
    if (!Number.isFinite(fontSize) || fontSize <= 0) continue;

    pdf.setFontSize(fontSize);
    // Left-aligned on purpose: jsPDF reads `x` as the anchor for whatever
    // alignment it is given, so a centred run would be drawn half a box to the
    // right of the line it is meant to sit on. `rect` is already the laid-out
    // box, so its left edge is the alignment.
    pdf.text(
      text,
      (rect.left - sourceRect.left) * positionScale,
      (rect.top - sourceRect.top) * positionScale,
      {
        baseline: "top",
        maxWidth: rect.width * positionScale,
        renderingMode: "invisible",
      },
    );
  }
}

export async function exportDeckAsPdf(
  deckTitle: string,
  slides: PdfExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<void> {
  // modern-screenshot uses <foreignObject> SVG rendering, which delegates
  // text layout back to the browser. html2canvas / html2canvas-pro
  // re-implement text layout in JS and get per-character positioning wrong
  // on negative letter-spacing (very visible on our 900-weight headings).
  // JPEG (vs PNG) keeps a typical 8-slide deck under ~10 MB instead of
  // ~100 MB — at 0.92 quality the difference is invisible on slide content.
  const [{ domToJpeg }, { jsPDF }] = await Promise.all([
    importExportModule(() => import("modern-screenshot")),
    importExportModule(() => import("jspdf")),
  ]);

  // Web fonts (Poppins) must finish loading before capture — otherwise
  // text lays out with fallback metrics and draws with the real font,
  // producing severely overlapping characters.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  // Defensive fallback: getAspectRatioDims returns undefined for unknown
  // ratio strings (callers normally pass the validated Zod enum, but
  // ratios coming off old DB rows or external callers may not). See
  // commit 0bb5c827 — same pattern preserved through the modern-screenshot
  // rewrite.
  const dims = getAspectRatioDims(aspectRatio) ?? getAspectRatioDims(undefined);
  const orientation = dims.width >= dims.height ? "landscape" : "portrait";

  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [dims.width, dims.height],
  });

  for (let i = 0; i < slides.length; i++) {
    const slideId = slides[i].id;
    const source = findSlideExportSource(slideId, i, slides.length);

    // Force CORS-enabled re-fetch on every cross-origin <img> before
    // capture — otherwise the canvas tainting check inside modern-screenshot
    // produces a blank rect for the image.
    const restoreImages = await preloadImagesWithCors(source);

    let dataUrl: string;
    try {
      dataUrl = await domToJpeg(source, {
        width: dims.width,
        height: dims.height,
        scale: 2, // 2x for crisp text
        // guard:allow-raw-color — a PDF page has no theme to follow.
        backgroundColor: "#000000",
        quality: 0.92,
        // Pair with the in-DOM CORS preload above. modern-screenshot's
        // internal image fetcher needs no-cache so re-issued requests don't
        // get served the original tainted (no-CORS) response from the HTTP
        // cache, and an anonymous-CORS request mode so the response itself
        // is usable on a clean canvas.
        //
        // `same-origin` rather than `omit`: images the preload rewrote to
        // /api/image-proxy are same-origin and that route needs the session
        // cookie, so omitting credentials would 401 exactly the images this
        // is meant to rescue. Cross-origin requests still go out anonymously,
        // which is what CORS mode requires.
        fetch: {
          requestInit: {
            cache: "no-cache",
            mode: "cors",
            credentials: "same-origin",
          },
        },
      });
    } finally {
      restoreImages();
    }

    if (i > 0) pdf.addPage([dims.width, dims.height], orientation);
    pdf.addImage(dataUrl, "JPEG", 0, 0, dims.width, dims.height);
    drawSelectableTextLayer(pdf, source, dims);
  }

  // Carried so `import-file` can hand back the deck that was exported instead
  // of reconstructing one from the page render. Written last: jsPDF holds a
  // single metadata stream for the whole document, not per page.
  const sidecar = encodeSidecar({
    v: 1,
    title: deckTitle,
    ...(aspectRatio ? { aspectRatio } : {}),
    slides: slides.map(({ id: _id, ...slide }) => ({
      ...slide,
      content: slide.content ?? "",
    })),
  });
  if (sidecar) pdf.addMetadata(sidecar, SLIDES_PDF_SIDECAR_NAMESPACE);

  const safeName = deckTitle.replace(/[^a-zA-Z0-9]/g, "-");
  // Explicit blob + anchor download: jsPDF's pdf.save() can be silently
  // blocked by some browsers when the call lands outside a direct user
  // gesture (e.g. after the async render loop above).
  const blob = pdf.output("blob");
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
