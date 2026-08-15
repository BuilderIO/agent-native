import { readFileSync, writeFileSync } from "node:fs";
import { parsePptxPresentation } from "@agent-native/core/ingestion";
import { convertToSlideHtml } from "./server/handlers/import/html-converter";

const buf = readFileSync(
  "data/uploads/8d88f02d8c4cd6719fac1e81/games-fund-game-company-pitch-deck.pptx",
);
const parsed = await parsePptxPresentation(buf);
writeFileSync("/tmp/parsed.json", JSON.stringify(parsed, (k, v) => (k === "data" ? "<bin>" : v), 2));
const themeFont = (parsed as any).theme?.fonts?.[0];
parsed.slides.forEach((s: any, i: number) => {
  const urls: Record<string, string> = {};
  for (const el of s.elements ?? []) if (el.kind === "image") urls[el.id] = `IMG:${el.image?.name ?? el.id}`;
  writeFileSync(`/tmp/gen_slide${i + 1}.html`, convertToSlideHtml(s, urls, themeFont));
});
console.log("slides:", parsed.slides.length, "themeFont:", themeFont);
