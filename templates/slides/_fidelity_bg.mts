import { readFileSync } from "node:fs";
import { parsePptx } from "./server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "./server/handlers/import/html-converter.js";
const parsed: any = await parsePptx(new Uint8Array(readFileSync(process.argv[2])));
const font = parsed.theme?.fonts?.[0];
parsed.slides.forEach((s: any, i: number) => {
  const html = convertToSlideHtml(s, undefined, font);
  const m = html.match(/background: ([^;]+);/);
  console.log(`${i + 1}\t${s.background ?? "-"}\t${m ? m[1] : "NONE"}`);
});
