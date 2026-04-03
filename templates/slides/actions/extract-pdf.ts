import fs from "fs";
import { PDFParse } from "pdf-parse";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/extract-pdf.ts <path-to-pdf>");
  throw new Error("Script failed");
}

async function main() {
  const buf = fs.readFileSync(pdfPath);
  const pdf = new PDFParse(new Uint8Array(buf));
  await pdf.load();
  const result = await pdf.getText();
  const pages = result.pages || [];
  console.log("Total pages:", pages.length);
  pages.forEach((page: { num: number; text: string }) => {
    console.log(`\n=== PAGE ${page.num} ===`);
    console.log(page.text);
  });
}

main().catch((e) => console.error(e));
