import type { DocumentImportFormat } from "@shared/document-import";

export async function extractDocumentText(
  file: File,
  format: DocumentImportFormat,
): Promise<string> {
  if (format === "markdown" || format === "text") return file.text();
  const data = await file.arrayBuffer();
  if (format === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    return result.value;
  }
  return extractPdfText(data);
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text.trim());
    }
    return pages.filter(Boolean).join("\n\n");
  } finally {
    await document.destroy();
  }
}
