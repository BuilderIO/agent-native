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
    const row = {
      slide: Number(slide),
      x: Number(x),
      base: Number(base),
      right: Number(right),
      text: norm(text.join("|")),
      used: false,
    };
    // A row that parsed to NaN compares false against every tolerance, so it
    // would sail through as a line nobody actually measured.
    if (![row.slide, row.x, row.base, row.right].every(Number.isFinite)) {
      console.error(`Malformed row in ${googleFile}: ${line}`);
      process.exit(1);
    }
    return row;
  });

let lines = 0,
  breakMismatches = 0,
  unmatched = 0;
const dys: number[] = [],
  dxs: number[] = [];
const slideNumberOf = (name: string) => Number(name.match(/\d+/)![0]);
const layoutFiles = readdirSync(anDir)
  .filter((name) => /^slide-\d+\.json$/.test(name))
  // Numeric, not lexicographic: the names are zero-padded to two digits, so a
  // deck of 100 or more would otherwise sort slide-100 between 10 and 11.
  .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));
// Comparing nothing is not a pass: without this the run prints zero mismatches
// and NaN statistics, and exits 0.
if (!layoutFiles.length) {
  console.error(`No slide-NN.json layout files in ${anDir}`);
  process.exit(1);
}
// A dump that stopped partway leaves a gap; a dump that stopped at the end
// leaves nothing to see, so `--slides <n>` holds it to the deck's own count.
const slideNumbers = layoutFiles.map((name) => Number(name.match(/\d+/)![0]));
if (slideNumbers.some((value, index) => value !== index + 1)) {
  console.error(
    `Layout dump is not a contiguous slide-01..N set in ${anDir}: got ${slideNumbers.join(", ")}`,
  );
  process.exit(1);
}
const expectedSlides = Number(
  process.argv[process.argv.indexOf("--slides") + 1],
);
if (!(expectedSlides > 0)) {
  // Say so rather than pass quietly: a dump and a readback that both stopped
  // early agree with each other, and nothing here can tell from the inside.
  console.warn(
    `No --slides <n> given, so ${slideNumbers.length} slide(s) are taken as the whole deck.`,
  );
} else if (slideNumbers.length !== expectedSlides) {
  console.error(
    `Layout dump has ${slideNumbers.length} slide(s), expected ${expectedSlides}`,
  );
  process.exit(1);
}
for (const file of layoutFiles) {
  const { slide, texts } = JSON.parse(
    readFileSync(path.join(anDir, file), "utf8"),
  );
  const pool = google.filter((entry) => entry.slide === slide);
  const slideLines = (texts as { lines: unknown[] }[]).reduce(
    (sum, text) => sum + text.lines.length,
    0,
  );
  // A slide missing from the readback is an extraction that stopped early, not
  // a slide that matched: counting it clean is how a half-finished run passes.
  if (!pool.length) {
    lines += slideLines;
    unmatched += slideLines;
    console.log(
      `slide ${slide}: NO GOOGLE ROWS — ${slideLines} line(s) counted unmatched`,
    );
    continue;
  }
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

// `dys` and `dxs` are pushed together, so one index is one line.
const outOfTolerance = dys.filter(
  (value, index) => Math.abs(value) > 1.5 || Math.abs(dxs[index]) > 1.5,
).length;
// Rows Google has that no Chrome line claimed: text the export duplicated or
// invented, or a whole slide the deck never had.
const unclaimed = google.filter((entry) => !entry.used);
if (unclaimed.length) {
  const slides = [...new Set(unclaimed.map((entry) => entry.slide))].sort(
    (a, b) => a - b,
  );
  console.log(
    `UNCLAIMED ${unclaimed.length} google row(s) on slide(s) ${slides.join(", ")}`,
  );
}
if (unmatched || breakMismatches || outOfTolerance || unclaimed.length) {
  console.log(
    `FAIL: ${unmatched} unmatched, ${breakMismatches} break mismatch(es), ${outOfTolerance} line(s) over 1.5px, ${unclaimed.length} unclaimed google row(s)`,
  );
  process.exitCode = 1;
}
