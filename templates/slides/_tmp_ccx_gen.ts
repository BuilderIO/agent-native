import { readFileSync, writeFileSync } from "node:fs";
import { parsePptxPresentation } from "@agent-native/core/ingestion";
import { convertToSlideHtml } from "/Users/steve/Projects/builder/agent-native/framework/templates/slides/server/handlers/import/html-converter";

const buf = readFileSync(
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81/creative-circus-brand-style-guide.pptx",
);
const parsed: any = await parsePptxPresentation(buf);
const themeFont = parsed.theme?.fonts?.[0];
parsed.slides.forEach((s: any, i: number) => {
  const urls: Record<string, string> = {};
  for (const el of s.elements ?? []) if (el.kind === "image") urls[el.id] = `IMG:${el.image?.name ?? el.id}`;
  writeFileSync(`/tmp/ccx_slide${i + 1}.html`, convertToSlideHtml(s, urls, themeFont));
});
console.log("slides:", parsed.slides.length, "themeFont:", themeFont);
