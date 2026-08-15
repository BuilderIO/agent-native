import { readFile } from "node:fs/promises";

import { parsePptxPresentation } from "@agent-native/core/ingestion";
import { describe, it } from "vitest";

import { convertToSlideHtml } from "./html-converter.js";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

describe("scratch", () => {
  it("counts table borders in real decks", async () => {
    for (const name of [
      "games-fund-game-company-pitch-deck",
      "creandum-board-deck-template",
    ]) {
      const buffer = await readFile(`${DIR}/${name}.pptx`);
      const presentation = await parsePptxPresentation(new Uint8Array(buffer));
      presentation.slides.forEach((slide, index) => {
        const html = convertToSlideHtml(slide);
        const tables = html.match(/fmd-pptx-table/g)?.length ?? 0;
        if (tables === 0) return;
        const cells = html.match(/<td /g)?.length ?? 0;
        const tableMarkup = html.slice(
          html.indexOf("<table"),
          html.indexOf("</table>"),
        );
        const borders =
          tableMarkup.match(/border-(top|right|bottom|left):/g)?.length ?? 0;
        const colgroup = html.match(/<col /g)?.length ?? 0;
        const rows = html.match(/<tr/g)?.length ?? 0;
        const colors = [
          ...new Set(html.match(/border-\w+:[\d.]+px \w+ (#\w+)/g) ?? []),
        ];
        console.log(
          `${name} slide${index + 1}: tables=${tables} cols=${colgroup} rows=${rows} cells=${cells} borderDecls=${borders} collapse=${html.includes("border-collapse:collapse")}`,
        );
        console.log(`   distinct: ${colors.slice(0, 4).join(" | ")}`);
      });
    }
  }, 120000);
});
