import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  SLIDES_PDF_SIDECAR_NAMESPACE,
  type SlidesPdfSidecar,
} from "../../../shared/pdf-sidecar.js";
import { parsePdfFidelity } from "./pdf-fidelity-parser.js";
import { readSlidesPdfSidecar } from "./pdf-sidecar-reader.js";

/**
 * The deck PDF round trip, end to end against the real libraries: a PDF built
 * by the same jsPDF the exporter uses, read back by the same pdfjs the importer
 * uses. Exporting a deck and importing it again has to return editable slides —
 * the bug this covers shipped a PDF whose pages were nothing but a JPEG, so
 * every re-import produced one full-slide image and no text.
 */

function newPdf(): jsPDF {
  return new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [1920, 1080],
  });
}

async function open(pdf: jsPDF): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(pdf.output("arraybuffer")) })
    .promise;
}

function elementText(element: {
  paragraphs?: { runs: { content: string }[] }[];
}) {
  return (element.paragraphs ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.content).join(""))
    .join(" ");
}

/** A 2x2 JPEG, standing in for a rasterized slide page. */
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAIBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

describe("PDF round trip", () => {
  it("rebuilds positioned, editable text from a PDF that carries real text", async () => {
    const pdf = newPdf();
    pdf.setFontSize(72);
    pdf.text("Quarterly Business Review", 120, 300);
    pdf.setFontSize(32);
    pdf.text("Revenue grew 42% year over year", 120, 420);

    const doc = await open(pdf);
    const [page] = await parsePdfFidelity(doc, []);
    await doc.destroy();

    const texts = page.elements.filter((element) => element.kind === "text");
    expect(texts.map(elementText)).toEqual([
      "Quarterly Business Review",
      "Revenue grew 42% year over year",
    ]);
    // Real placement, not a stacked template: the second line sits below the
    // first and both keep the left margin they were drawn at.
    expect(texts[0].x).toBeGreaterThan(0);
    expect(texts[1].y).toBeGreaterThan(texts[0].y);
  });

  it("has nothing but an image to recover from a page that is only a raster — the shape of the bug", async () => {
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);

    const doc = await open(pdf);
    const [page] = await parsePdfFidelity(doc, []);
    await doc.destroy();

    expect(page.elements.some((element) => element.kind === "text")).toBe(
      false,
    );
  });

  it("does not rebuild a page's own OCR layer as visible text on top of it", async () => {
    // This is the shape of a Slides export whose XMP sidecar was stripped by
    // another PDF tool: the words are baked into the page raster AND present as
    // an invisible text layer. Reconstructing both prints every heading twice,
    // once from the image and once in the wrong font over it.
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.setFontSize(72);
    pdf.text("Quarterly Business Review", 120, 300, {
      baseline: "top",
      renderingMode: "invisible",
    });

    const doc = await open(pdf);
    const [page] = await parsePdfFidelity(doc, []);
    const extractable = (await (await doc.getPage(1)).getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join("");
    await doc.destroy();

    expect(page.elements.some((element) => element.kind === "text")).toBe(
      false,
    );
    // Still selectable and searchable in any PDF reader — it is only the
    // visible reconstruction that skips it.
    expect(extractable).toContain("Quarterly Business Review");
  });

  it("still rebuilds text that the page actually draws", async () => {
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.setFontSize(72);
    pdf.text("Drawn over the photo", 120, 300, { baseline: "top" });

    const doc = await open(pdf);
    const [page] = await parsePdfFidelity(doc, []);
    await doc.destroy();

    expect(
      page.elements
        .filter((element) => element.kind === "text")
        .map(elementText),
    ).toEqual(["Drawn over the photo"]);
  });

  it("restores the exported deck from the sidecar instead of reconstructing it", async () => {
    const sidecar: SlidesPdfSidecar = {
      v: 1,
      title: "Quarterly Business Review",
      aspectRatio: "16:9",
      slides: [
        {
          content:
            '<div class="fmd-slide"><h1 style="color: #ff0000">Growth &amp; margin</h1></div>',
          notes: "Open with the revenue number.",
          layout: "title",
        },
        { content: '<div class="fmd-slide"><p>Second slide</p></div>' },
      ],
    };
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.addPage([1920, 1080], "landscape");
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.addMetadata(
      Buffer.from(JSON.stringify(sidecar), "utf8").toString("base64"),
      SLIDES_PDF_SIDECAR_NAMESPACE,
    );

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result).toEqual({ status: "found", sidecar });
  });

  it("refuses a sidecar whose slide count no longer matches the PDF's pages", async () => {
    // The sidecar is one document-level stream, so deleting pages in Preview or
    // Acrobat leaves it describing a deck the file no longer is. Restoring it
    // would hand back slides the user is not looking at.
    const sidecar: SlidesPdfSidecar = {
      v: 1,
      slides: [
        { content: '<div class="fmd-slide"><p>One</p></div>' },
        { content: '<div class="fmd-slide"><p>Two</p></div>' },
      ],
    };
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.addMetadata(
      Buffer.from(JSON.stringify(sidecar), "utf8").toString("base64"),
      SLIDES_PDF_SIDECAR_NAMESPACE,
    );

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result.status).toBe("unreadable");
  });

  it("rejects a payload whose fields are not the types the deck row expects", async () => {
    const pdf = newPdf();
    pdf.addMetadata(
      Buffer.from(
        JSON.stringify({
          v: 1,
          title: { not: "a string" },
          slides: [{ content: "<p>x</p>" }],
        }),
        "utf8",
      ).toString("base64"),
      SLIDES_PDF_SIDECAR_NAMESPACE,
    );

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result.status).toBe("unreadable");
  });

  it("carries a slide's transition, background and reveal metadata through the round trip", async () => {
    const sidecar: SlidesPdfSidecar = {
      v: 1,
      slides: [
        {
          content: '<div class="fmd-slide"><p>One</p></div>',
          transition: "fade",
          background: "#101820",
          splitByParagraph: true,
          animations: [{ target: 0 }],
        },
      ],
    };
    const pdf = newPdf();
    pdf.addImage(TINY_JPEG, "JPEG", 0, 0, 1920, 1080);
    pdf.addMetadata(
      Buffer.from(JSON.stringify(sidecar), "utf8").toString("base64"),
      SLIDES_PDF_SIDECAR_NAMESPACE,
    );

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result).toEqual({ status: "found", sidecar });
  });

  it("reports a corrupt sidecar rather than quietly importing the page render", async () => {
    const pdf = newPdf();
    pdf.addMetadata("not-base64-json!!", SLIDES_PDF_SIDECAR_NAMESPACE);

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result.status).toBe("unreadable");
  });

  it("treats a foreign PDF as having no sidecar", async () => {
    const pdf = newPdf();
    pdf.text("Someone else's deck", 120, 300);
    pdf.addMetadata(
      "<dc:title>unrelated</dc:title>",
      "http://purl.org/dc/elements/1.1/",
    );

    const doc = await open(pdf);
    const result = await readSlidesPdfSidecar(doc);
    await doc.destroy();

    expect(result).toEqual({ status: "absent" });
  });
});
