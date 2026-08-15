import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";
import { parsePptx } from "./pptx-parser.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

describe("scratch", () => {
  it("counts", { timeout: 300000 }, async () => {
      for (const name of [
        "slidesmania-infographics-set1",
        "slidesmania-infographics-set2",
        "slidesmania-soze",
        "slidesmania-canyon",
      ]) {
        const data = await readFile(`${DIR}/${name}.pptx`);
        const parsed = await parsePptx(new Uint8Array(data));
        let totalClip = 0;
        let totalStroke = 0;
        const perSlide: string[] = [];
        parsed.slides.forEach((slide, index) => {
          const html = convertToSlideHtml(slide);
          const clip = html.match(/clip-path: path\(/g)?.length ?? 0;
          const stroke = html.match(/<svg viewBox/g)?.length ?? 0;
          const geo =
            slide.elements?.filter((element) => element.geometry).length ?? 0;
          totalClip += clip;
          totalStroke += stroke;
          if (geo)
            perSlide.push(
              `s${index + 1}: geom=${geo} clip=${clip} stroke=${stroke} html=${Math.round(html.length / 1024)}kb`,
            );
        });
        console.log(
          `\n== ${name}: clip=${totalClip} stroke=${totalStroke}\n  ${perSlide.join("\n  ")}`,
        );
    }
  });
});
