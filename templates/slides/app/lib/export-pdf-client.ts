/**
 * Client-side PDF export. Renders each slide element to a canvas via
 * html2canvas, then assembles them into a PDF at the deck's aspect ratio.
 *
 * Usage:
 *   const slideEls = Array.from(document.querySelectorAll('.slide-content'));
 *   await exportDeckAsPdf('My Deck', slideEls as HTMLElement[], deck.aspectRatio);
 */
import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";

export async function exportDeckAsPdf(
  deckTitle: string,
  slideElements: HTMLElement[],
  aspectRatio?: AspectRatio,
): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const dims = getAspectRatioDims(aspectRatio) ?? getAspectRatioDims(undefined);
  const orientation = dims.width >= dims.height ? "landscape" : "portrait";

  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [dims.width, dims.height],
  });

  for (let i = 0; i < slideElements.length; i++) {
    const canvas = await html2canvas(slideElements[i], {
      width: dims.width,
      height: dims.height,
      scale: 2, // 2x for crisp text
      backgroundColor: "#000000",
      useCORS: true,
    });

    if (i > 0) pdf.addPage([dims.width, dims.height], orientation);

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", 0, 0, dims.width, dims.height);
  }

  const safeName = deckTitle.replace(/[^a-zA-Z0-9]/g, "-");
  pdf.save(`${safeName}.pdf`);
}
