import { readFile } from "node:fs/promises";

import { it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import { parsePptx } from "./pptx-parser.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

it("measures", async () => {
  for (const [file, n] of [
    ["nicest-pitch-deck-template", 21],
    ["slidesmania-soze", 2],
  ] as const) {
    const parsed = await parsePptx(await readFile(`${DIR}/${file}.pptx`));
    const slide = parsed.slides[n - 1]!;
    const html = convertToSlideHtml(slide, undefined, parsed.theme?.fonts?.[0]);
    const clippedImages = [
      ...html.matchAll(/<div class="fmd-pptx-image"[^>]*>/g),
    ].filter((m) => /border-radius|clip-path/.test(m[0])).length;
    console.log(
      `${file} slide ${n}: elements=${slide.elements?.length} strokeSvg=${
        html.match(/<svg/g)?.length ?? 0
      } clippedImages=${clippedImages} borderPx=${
        html.match(/border(?:-[a-z]+)?: [\d.]+px/g)?.length ?? 0
      }`,
    );
  }
});
