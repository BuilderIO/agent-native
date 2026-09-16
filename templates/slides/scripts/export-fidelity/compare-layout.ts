// Compares Chromium's per-line text layout (export.ts layout/slide-NN.json)
// with Google Slides' layout transcribed from its editor SVG.
//   pnpm exec tsx compare-layout.ts <anLayoutDir> <google.txt>
// google.txt: one line per Google text line, "slide|x|baseline|right|text".
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const [anDir, googleFile] = process.argv.slice(2);
const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
type G = {
  slide: number;
  x: number;
  base: number;
  right: number;
  text: string;
  used: boolean;
};
const google: G[] = readFileSync(googleFile, "utf8")
  .split("\n")
  .filter((line) => line.includes("|"))
  .map((line) => {
    const [slide, x, base, right, ...text] = line.split("|");
    return {
      slide: Number(slide),
      x: Number(x),
      base: Number(base),
      right: Number(right),
      text: norm(text.join("|")),
      used: false,
    };
  });

let lines = 0,
  breakMismatches = 0,
  unmatched = 0;
const dys: number[] = [],
  dxs: number[] = [];
for (const file of readdirSync(anDir)
  .filter((name) => /^slide-\d+\.json$/.test(name))
  .sort()) {
  const { slide, texts } = JSON.parse(
    readFileSync(path.join(anDir, file), "utf8"),
  );
  const pool = google.filter((entry) => entry.slide === slide);
  if (!pool.length) continue;
  const rows: string[] = [];
  for (const text of texts) {
    for (const line of text.lines) {
      lines++;
      const wanted = norm(line.text);
      const nearest = (candidates: G[]) =>
        candidates.sort(
          (a, b) =>
            Math.hypot(a.x - line.x, a.base - line.baseline) -
            Math.hypot(b.x - line.x, b.base - line.baseline),
        )[0];
      const exact = nearest(
        pool.filter((entry) => !entry.used && entry.text === wanted),
      );
      const match =
        exact ??
        nearest(
          pool.filter(
            (entry) =>
              !entry.used &&
              (entry.text.startsWith(wanted.slice(0, 10)) ||
                wanted.startsWith(entry.text.slice(0, 10))),
          ),
        );
      if (!match) {
        unmatched++;
        rows.push(`  MISSING "${line.text.slice(0, 40)}"`);
        continue;
      }
      match.used = true;
      if (!exact) {
        breakMismatches++;
        rows.push(
          `  BREAK   chrome "${line.text.slice(0, 40)}" vs google "${match.text.slice(0, 40)}"`,
        );
      }
      const dy = match.base - line.baseline;
      // Measure the edge the alignment holds. Google sets its own glyph widths,
      // so the free edge of a line moves on its own and would read as a
      // position error that is not one.
      const anchor =
        text.align === "center"
          ? "centre"
          : text.align === "right" || text.align === "end"
            ? "right"
            : "left";
      const dx =
        anchor === "centre"
          ? (match.x + match.right) / 2 - (line.x + line.right) / 2
          : anchor === "right"
            ? match.right - line.right
            : match.x - line.x;
      dys.push(dy);
      dxs.push(dx);
      if (Math.abs(dy) > 1.5 || Math.abs(dx) > 1.5) {
        rows.push(
          `  OFF dy ${dy.toFixed(1)} d${anchor} ${dx.toFixed(1)} "${line.text.slice(0, 30)}" (${text.font.family} ${text.font.sizePx}px lh ${text.font.lineHeightPx} ls ${text.font.letterSpacingPx} ${text.align})`,
        );
      }
    }
  }
  console.log(
    `slide ${slide}: ${rows.length ? "\n" + rows.join("\n") : "all lines within 1.5px, same breaks"}`,
  );
}
const at = (values: number[], p: number) => {
  const s = values.map(Math.abs).sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.floor(s.length * p))]
    : Number.NaN;
};
console.log(
  `\nlines ${lines}, unmatched ${unmatched}, break mismatches ${breakMismatches}; |dy| median ${at(dys, 0.5).toFixed(2)} p95 ${at(dys, 0.95).toFixed(2)} max ${at(dys, 1).toFixed(2)}; |dx| median ${at(dxs, 0.5).toFixed(2)} p95 ${at(dxs, 0.95).toFixed(2)} max ${at(dxs, 1).toFixed(2)}`,
);
