import fs from "fs";
import { PDFParse } from "pdf-parse";
import { parseArgs } from "@agent-native/core";

export default async function (args: string[]) {
  const { path: pdfPath } = parseArgs(args);
  if (!pdfPath) {
    console.error("Usage: pnpm action extract-pdf --path <path-to-pdf>");
    throw new Error("Missing --path argument");
  }

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
