import { readFileSync, writeFileSync } from "node:fs";
import { parsePptx } from "./server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "./server/handlers/import/html-converter.js";
const parsed: any = await parsePptx(new Uint8Array(readFileSync(process.argv[2])));
const font = parsed.theme?.fonts?.[0];
for (const n of [3, 35, 7]) {
  const s = parsed.slides[n - 1];
  console.log(`\n===== SLIDE ${n} parsed: background=${JSON.stringify(s.background)} elements=${s.elements?.length} images=${s.images?.length} texts=${s.texts?.length}`);
  console.log(convertToSlideHtml(s, undefined, font).slice(0, 900));
}
