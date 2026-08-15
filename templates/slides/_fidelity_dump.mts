import { readFileSync, writeFileSync } from "node:fs";
import { parsePptx } from "./server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "./server/handlers/import/html-converter.js";

const buf = readFileSync(process.argv[2]);
const parsed: any = await parsePptx(new Uint8Array(buf));
console.log("theme:", JSON.stringify(parsed.theme));
const font = parsed.theme?.fonts?.[0];
for (const n of (process.argv[3] ?? "1").split(",").map(Number)) {
  const s = parsed.slides[n - 1];
  const html = convertToSlideHtml(s, undefined, font);
  writeFileSync(`/tmp/gen_slide${n}.html`, html);
  writeFileSync(`/tmp/parsed_slide${n}.json`, JSON.stringify(s, (k, v) => (k === "data" ? `<bytes>` : v), 2));
  console.log(`slide${n}: ${html.length} chars, elements=${s.elements?.length}`);
}
