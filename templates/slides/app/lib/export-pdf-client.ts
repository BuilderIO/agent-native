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
  // editor canvas); pick the one with the largest natural width so we
  // capture full-resolution pixels even when the visible copy is scaled
  // down via CSS transform.
  return candidates.reduce((best, el) =>
    el.offsetWidth > best.offsetWidth ? el : best,
  );
}

export async function exportDeckAsPdf(
  deckTitle: string,
  slideIds: string[],
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

  for (let i = 0; i < slideIds.length; i++) {
    const slideId = slideIds[i];
    const source = findSlideExportSource(slideId, i, slideIds.length);

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
  }

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
