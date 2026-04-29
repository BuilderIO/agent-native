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
import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";

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
  const { domToJpeg } = await import("modern-screenshot");
  const { jsPDF } = await import("jspdf");

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
  const dims =
    getAspectRatioDims(aspectRatio) ?? getAspectRatioDims(undefined);
  const orientation = dims.width >= dims.height ? "landscape" : "portrait";

  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [dims.width, dims.height],
  });

  let pageIndex = 0;
  for (const slideId of slideIds) {
    // A given slide can appear multiple times (sidebar thumbnail + active
    // editor canvas); pick the one with the largest natural width so we
    // capture full-resolution pixels even when the visible copy is scaled
    // down via CSS transform.
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-slide-canvas="${CSS.escape(slideId)}"]`,
      ),
    );
    if (candidates.length === 0) continue;
    const source = candidates.reduce((best, el) =>
      el.offsetWidth > best.offsetWidth ? el : best,
    );

    const dataUrl = await domToJpeg(source, {
      width: dims.width,
      height: dims.height,
      scale: 2, // 2x for crisp text
      backgroundColor: "#000000",
      quality: 0.92,
    });

    if (pageIndex > 0) pdf.addPage([dims.width, dims.height], orientation);
    pdf.addImage(dataUrl, "JPEG", 0, 0, dims.width, dims.height);
    pageIndex++;
  }

  if (pageIndex === 0) {
    throw new Error("No slide canvases found to render.");
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
