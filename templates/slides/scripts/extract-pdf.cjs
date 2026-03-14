const fs = require("fs");
const { PDFParse } = require("pdf-parse");

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/extract-pdf.cjs <path-to-pdf>");
  process.exit(1);
}

async function main() {
  const buf = fs.readFileSync(pdfPath);
  const pdf = new PDFParse(new Uint8Array(buf));
  await pdf.load();
  const result = await pdf.getText();
  const pages = result.pages || [];
  console.log("Total pages:", pages.length);
  pages.forEach((page) => {
    console.log(`\n=== PAGE ${page.num} ===`);
    console.log(page.text);
  });
}

main().catch((e) => console.error(e));
