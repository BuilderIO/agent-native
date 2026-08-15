import { readFile } from "node:fs/promises";

import { it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import { parsePptx } from "./pptx-parser.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

const DECKS = [
  "slidesmania-soze",
  "slidesmania-canyon",
  "slidesmania-raven",
  "slidesmania-infographics-set1",
  "slidesmania-infographics-set2",
  "games-fund-game-company-pitch-deck",
  "nicest-pitch-deck-template",
  "creandum-board-deck-template",
  "superteam-brand-guidelines",
  "creative-circus-brand-style-guide",
  "posette-keynote-2024",
];

function count(html: string, needle: RegExp) {
  return html.match(needle)?.length ?? 0;
}

it("sweeps", async () => {
  let totalShapedImages = 0;
  let totalStrokeSvg = 0;
  for (const file of DECKS) {
    const parsed = await parsePptx(await readFile(`${DIR}/${file}.pptx`));
    let shapedImages = 0;
    let strokeSvg = 0;
    for (const slide of parsed.slides) {
      const html = convertToSlideHtml(slide, undefined, parsed.theme?.fonts?.[0]);
      for (const div of html.matchAll(/<div class="fmd-pptx-image"[^>]*>/g)) {
        if (/border-radius|clip-path/.test(div[0])) shapedImages++;
      }
      strokeSvg += count(html, /<svg/g);
    }
    totalShapedImages += shapedImages;
    totalStrokeSvg += strokeSvg;
    console.log(
      `${file}: shapedImages=${shapedImages} strokeSvg=${strokeSvg} slides=${parsed.slides.length}`,
    );
  }
  console.log(`TOTAL shapedImages=${totalShapedImages} strokeSvg=${totalStrokeSvg}`);
});
