/**
 * Client-side PDF export. Renders each slide element to a canvas via
 * html2canvas, then assembles them into a landscape PDF with jsPDF.
 *
 * Usage:
 *   const slideEls = Array.from(document.querySelectorAll('.slide-element'));
 *   await exportDeckAsPdf('My Deck', slideEls as HTMLElement[]);
 */
export async function exportDeckAsPdf(
  deckTitle: string,
  slideElements: HTMLElement[],
): Promise<void> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  // Landscape PDF at slide resolution (960 x 540 px)
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [960, 540],
  });

  for (let i = 0; i < slideElements.length; i++) {
    const canvas = await html2canvas(slideElements[i], {
      width: 960,
      height: 540,
      scale: 2, // 2x for crisp text
      backgroundColor: "#000000",
      useCORS: true,
    });

    if (i > 0) pdf.addPage([960, 540], "landscape");

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", 0, 0, 960, 540);
  }

  const safeName = deckTitle.replace(/[^a-zA-Z0-9]/g, "-");
  pdf.save(`${safeName}.pdf`);
}
