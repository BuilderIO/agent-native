import { readFile } from "node:fs/promises";

import { parsePptx } from "./server/handlers/import/pptx-parser.js";
import { convertToSlideHtml } from "./server/handlers/import/html-converter.js";

const dir = "data/uploads/8d88f02d8c4cd6719fac1e81";
const targets = new Set([
  "uturnArrow",
  "halfFrame",
  "heart",
  "pie",
  "bentArrow",
]);

for (const name of process.argv.slice(2)) {
  const parsed = await parsePptx(await readFile(`${dir}/${name}.pptx`));
  let declared = 0;
  let painted = 0;
  let emptyBox = 0;
  parsed.slides.forEach((slide, index) => {
    const wanted = slide.elements.filter(
      (element) => element.shapeType && targets.has(element.shapeType),
    );
    if (wanted.length === 0) return;
    const html = convertToSlideHtml(slide);
    const clipped =
      (html.match(/clip-path: path\(/g)?.length ?? 0) +
      (html.match(/clip-path: polygon\(/g)?.length ?? 0);
    const blanks =
      html.match(/box-sizing: border-box;(?:[^"]*?)?"><\/div>/g)?.length ?? 0;
    declared += wanted.length;
    painted += clipped;
    emptyBox += blanks;
    console.log(
      `${name} slide ${index + 1}: declared=${wanted.length} (${wanted
        .map((element) => element.shapeType)
        .join(",")}) clipped=${clipped} emptyDivs=${blanks}`,
    );
  });
  console.log(
    `${name} TOTAL declared=${declared} clipped=${painted} emptyDivs=${emptyBox}`,
  );
}
