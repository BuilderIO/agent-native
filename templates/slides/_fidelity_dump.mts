import { readFileSync, writeFileSync } from "node:fs";
import { parsePptx } from "./server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "./server/handlers/import/html-converter.js";
const OUT = "/Users/steve/Projects/builder/agent-native/framework/.fidelity-shots/creandum";
const parsed: any = await parsePptx(new Uint8Array(readFileSync(process.argv[2])));
const font = parsed.theme?.fonts?.[0];
for (const n of (process.argv[3] ?? "1").split(",").map(Number)) {
  const s = parsed.slides[n - 1];
  const html = convertToSlideHtml(s, undefined, font);
  writeFileSync(`${OUT}/gen${n}.html`, html);
  writeFileSync(`${OUT}/parsed${n}.json`, JSON.stringify(s, (k, v) => (k === "data" ? "<bytes>" : v), 2));
  console.log(`slide${n}: ${html.length} chars, elements=${s.elements?.length}, firstText=${JSON.stringify((s.texts?.[0]?.content ?? "").slice(0, 40))}`);
}
