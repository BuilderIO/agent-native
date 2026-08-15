import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import { parsePptx } from "./pptx-parser.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

describe("scratch", () => {
  it("counts", { timeout: 600000 }, async () => {
    for (const name of [
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
    ]) {
      const data = await readFile(`${DIR}/${name}.pptx`);
      const parsed = await parsePptx(new Uint8Array(data));
      let clipTotal = 0;
      let strokeTotal = 0;
      let bytes = 0;
      let added = 0;
      const perSlide: string[] = [];
      parsed.slides.forEach((slide, index) => {
        const html = convertToSlideHtml(slide);
        const clip = html.match(/clip-path: path\(/g)?.length ?? 0;
        const stroke = html.match(/<svg viewBox/g)?.length ?? 0;
        const geo =
          slide.elements?.filter((element) => element.geometry).length ?? 0;
        const slideAdded = [
          ...(html.match(/clip-path: path\('[^']*'\);/g) ?? []),
          ...(html.match(/<svg viewBox[\s\S]*?<\/svg>/g) ?? []),
        ].reduce((sum, part) => sum + part.length, 0);
        clipTotal += clip;
        strokeTotal += stroke;
        bytes += html.length;
        added += slideAdded;
        if (geo)
          perSlide.push(
            `s${index + 1}: geom=${geo} clip=${clip} stroke=${stroke} html=${Math.round(html.length / 1024)}kb (+${Math.round(slideAdded / 1024)}kb)`,
          );
      });
      console.log(
        `\n== ${name}: slides=${parsed.slides.length} clipPaths=${clipTotal} strokeSvgs=${strokeTotal} deckHtml=${Math.round(bytes / 1024)}kb (was ~${Math.round((bytes - added) / 1024)}kb)\n  ${perSlide.join("\n  ")}`,
      );
    }
  });
});
