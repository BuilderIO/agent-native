import fs from "fs";

import { parseArgs } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { setupPdfParse } from "../server/lib/pdf-parse-setup.js";

function toCliArgs(args: Record<string, unknown>): string[] {
  return Object.entries(args).flatMap(([key, raw]) => {
    if (raw == null) return [];
    const value = String(raw);
    return value.startsWith("--") ? [`--${key}=${value}`] : [`--${key}`, value];
  });
}

async function main(args: string[]) {
  const { path: pdfPath } = parseArgs(args);
  if (!pdfPath) {
    console.error("Usage: pnpm action extract-pdf --path <path-to-pdf>");
    fail("Missing --path argument", {
      errorCode: "pdf_path_required",
      statusCode: 400,
    });
  }

  const buf = fs.readFileSync(pdfPath);
  const { PDFParse, canvasFactory } = await setupPdfParse();
  const pdf = new PDFParse({
    data: new Uint8Array(buf),
    CanvasFactory: canvasFactory,
  });
  const result = await pdf.getText().finally(() => pdf.destroy());
  const pages = result.pages || [];
  console.log("Total pages:", pages.length);
  pages.forEach((page: { num: number; text: string }) => {
    console.log(`\n=== PAGE ${page.num} ===`);
    console.log(page.text);
  });
}

export default defineAction({
  description: "Extract text from a local PDF for CLI use.",
  schema: z.object({ path: z.string().optional() }),
  http: false,
  agentTool: false,
  mcpTool: false,
  run: (args) => main(toCliArgs(args)),
});
