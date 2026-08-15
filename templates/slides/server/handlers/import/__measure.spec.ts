import { readFile } from "node:fs/promises";

import { it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import { parsePptx } from "./pptx-parser.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

async function slideHtml(file: string, oneBased: number) {
  const parsed = await parsePptx(await readFile(`${DIR}/${file}.pptx`));
  const slide = parsed.slides[oneBased - 1]!;
  return { html: convertToSlideHtml(slide, undefined, parsed.theme?.fonts?.[0]), slide };
}

function count(html: string, needle: string | RegExp) {
  const re =
    typeof needle === "string"
      ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : needle;
  return html.match(re)?.length ?? 0;
}

it("measures", async () => {
  for (const [file, n] of [
    ["nicest-pitch-deck-template", 21],
    ["slidesmania-soze", 2],
  ] as const) {
    const { html, slide } = await slideHtml(file, n);
    console.log(`\n### ${file} slide ${n} — elements=${slide.elements?.length}`);
    console.log("  fmd-pptx-shape :", count(html, "fmd-pptx-shape"));
    console.log("  fmd-pptx-image :", count(html, "fmd-pptx-image"));
    console.log("  fmd-pptx-text  :", count(html, "fmd-pptx-text"));
    console.log("  <svg           :", count(html, "<svg"));
    console.log("  clip-path      :", count(html, "clip-path"));
    console.log("  border-radius  :", count(html, "border-radius"));
    console.log("  border: Npx    :", count(html, /(?<!-)border: /g));
    for (const m of html.matchAll(
      /<div class="fmd-pptx-(?:shape|image)"[^>]*>/g,
    )) {
      console.log("   |", m[0].slice(0, 400));
    }
  }
});
