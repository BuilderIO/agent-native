import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const norm = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const TOLERANCE_PX = 1.5;

type GoogleRow = {
  slide: number;
  x: number;
  base: number;
  right: number;
  text: string;
  used: boolean;
};

type ChromeLine = {
  text: string;
  x: number;
  right: number;
  baseline: number;
};

type ChromeText = {
  align?: string;
  font: {
    family: string;
    sizePx: number;
    lineHeightPx: number;
    letterSpacingPx: number;
  };
  lines: ChromeLine[];
};

export interface LayoutComparisonResult {
  lines: number;
  unmatched: number;
  breakMismatches: number;
  outOfTolerance: number;
  unclaimed: number;
  dy: number[];
  dx: number[];
  output: string[];
  success: boolean;
}

function parseGoogleRows(googleFile: string): GoogleRow[] {
  return readFileSync(googleFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const fields = line.split("|");
      if (fields.length < 5) {
        throw new Error(`Malformed row in ${googleFile}: ${line}`);
      }
      const [slideText, xText, baseText, rightText, ...text] = fields;
      if (
        [slideText, xText, baseText, rightText].some((value) => !value.trim())
      ) {
        throw new Error(`Malformed row in ${googleFile}: ${line}`);
      }
      const row = {
        slide: Number(slideText),
        x: Number(xText),
        base: Number(baseText),
        right: Number(rightText),
        text: norm(text.join("|")),
        used: false,
      };
      if (![row.slide, row.x, row.base, row.right].every(Number.isFinite)) {
        throw new Error(`Malformed row in ${googleFile}: ${line}`);
      }
      return row;
    });
}

function slideNumberOf(name: string): number {
  const match = name.match(/\d+/);
  if (!match) throw new Error(`Invalid slide layout filename: ${name}`);
  return Number(match[0]);
}

function layoutFilesIn(anDir: string): string[] {
  const files = readdirSync(anDir)
    .filter((name) => /^slide-\d+\.json$/.test(name))
    .sort((a, b) => slideNumberOf(a) - slideNumberOf(b));
  if (!files.length)
    throw new Error(`No slide-NN.json layout files in ${anDir}`);
  const numbers = files.map(slideNumberOf);
  if (numbers.some((value, index) => value !== index + 1)) {
    throw new Error(
      `Layout dump is not a contiguous slide-01..N set in ${anDir}: got ${numbers.join(", ")}`,
    );
  }
  return files;
}

const percentile = (values: number[], p: number) => {
  const sorted = values.map(Math.abs).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    : Number.NaN;
};

export function compareLayoutFiles(
  anDir: string,
  googleFile: string,
  expectedSlides?: number,
): LayoutComparisonResult {
  const google = parseGoogleRows(googleFile);
  const layoutFiles = layoutFilesIn(anDir);
  if (expectedSlides !== undefined && layoutFiles.length !== expectedSlides) {
    throw new Error(
      `Layout dump has ${layoutFiles.length} slide(s), expected ${expectedSlides}`,
    );
  }

  let lines = 0;
  let breakMismatches = 0;
  let unmatched = 0;
  const dys: number[] = [];
  const dxs: number[] = [];
  const output: string[] = [];

  for (const file of layoutFiles) {
    const { slide, texts } = JSON.parse(
      readFileSync(path.join(anDir, file), "utf8"),
    ) as { slide: number; texts: ChromeText[] };
    const pool = google.filter((entry) => entry.slide === slide);
    const slideLines = texts.reduce((sum, text) => sum + text.lines.length, 0);
    if (!pool.length) {
      lines += slideLines;
      unmatched += slideLines;
      output.push(
        `slide ${slide}: NO GOOGLE ROWS - ${slideLines} line(s) counted unmatched`,
      );
      continue;
    }

    const rows: string[] = [];
    for (const text of texts) {
      for (const line of text.lines) {
        lines++;
        const wanted = norm(line.text);
        const nearest = (candidates: GoogleRow[]) =>
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
        if (Math.abs(dy) > TOLERANCE_PX || Math.abs(dx) > TOLERANCE_PX) {
          rows.push(
            `  OFF dy ${dy.toFixed(1)} d${anchor} ${dx.toFixed(1)} "${line.text.slice(0, 30)}" (${text.font.family} ${text.font.sizePx}px lh ${text.font.lineHeightPx} ls ${text.font.letterSpacingPx} ${text.align})`,
          );
        }
      }
    }
    output.push(
      `slide ${slide}: ${rows.length ? `\n${rows.join("\n")}` : `all lines within ${TOLERANCE_PX}px, same breaks`}`,
    );
  }

  const outOfTolerance = dys.filter(
    (value, index) =>
      Math.abs(value) > TOLERANCE_PX ||
      Math.abs(dxs[index] ?? 0) > TOLERANCE_PX,
  ).length;
  const unclaimedRows = google.filter((entry) => !entry.used);
  if (unclaimedRows.length) {
    const slides = [...new Set(unclaimedRows.map((entry) => entry.slide))].sort(
      (a, b) => a - b,
    );
    output.push(
      `UNCLAIMED ${unclaimedRows.length} google row(s) on slide(s) ${slides.join(", ")}`,
    );
  }
  output.push(
    `lines ${lines}, unmatched ${unmatched}, break mismatches ${breakMismatches}; |dy| median ${percentile(dys, 0.5).toFixed(2)} p95 ${percentile(dys, 0.95).toFixed(2)} max ${percentile(dys, 1).toFixed(2)}; |dx| median ${percentile(dxs, 0.5).toFixed(2)} p95 ${percentile(dxs, 0.95).toFixed(2)} max ${percentile(dxs, 1).toFixed(2)}`,
  );
  if (unmatched || breakMismatches || outOfTolerance || unclaimedRows.length) {
    output.push(
      `FAIL: ${unmatched} unmatched, ${breakMismatches} break mismatch(es), ${outOfTolerance} line(s) over ${TOLERANCE_PX}px, ${unclaimedRows.length} unclaimed google row(s)`,
    );
  }

  return {
    lines,
    unmatched,
    breakMismatches,
    outOfTolerance,
    unclaimed: unclaimedRows.length,
    dy: dys,
    dx: dxs,
    output,
    success:
      unmatched === 0 &&
      breakMismatches === 0 &&
      outOfTolerance === 0 &&
      unclaimedRows.length === 0,
  };
}
