import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareLayoutFiles } from "./compare-layout-lib.js";

const tempDirs: string[] = [];

function layoutDir(
  lines: Array<{
    text: string;
    x: number;
    right: number;
    baseline: number;
  }>,
  slide = 1,
) {
  const dir = mkdtempSync(join(tmpdir(), "slides-layout-"));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "slide-01.json"),
    JSON.stringify({
      slide,
      texts: [
        {
          align: "left",
          font: {
            family: "Inter",
            sizePx: 24,
            lineHeightPx: 28,
            letterSpacingPx: 0,
          },
          lines,
        },
      ],
    }),
  );
  return dir;
}

function googleFile(contents: string): string {
  const dir =
    tempDirs[tempDirs.length - 1] ??
    mkdtempSync(join(tmpdir(), "slides-google-"));
  if (!tempDirs.includes(dir)) tempDirs.push(dir);
  const file = join(dir, "google.txt");
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("Google Slides layout comparator", () => {
  it("passes an exact multi-line readback and records measured geometry", () => {
    const dir = layoutDir([
      { text: "Quarterly review", x: 10, right: 220, baseline: 50 },
      { text: "Revenue grew", x: 10, right: 150, baseline: 82 },
    ]);
    const file = googleFile(
      "1|10|50|220|Quarterly review\n1|10|82|150|Revenue grew\n",
    );

    const result = compareLayoutFiles(dir, file, 1);

    expect(result).toMatchObject({
      lines: 2,
      unmatched: 0,
      breakMismatches: 0,
      outOfTolerance: 0,
      unclaimed: 0,
      success: true,
    });
    expect(result.dy).toEqual([0, 0]);
    expect(result.dx).toEqual([0, 0]);
  });

  it("fails line-break drift, geometry drift, and extra Google rows", () => {
    const dir = layoutDir([
      { text: "Quarterly review", x: 10, right: 220, baseline: 50 },
    ]);
    const file = googleFile(
      "1|12|55|220|Quarterly\n1|10|50|220|Unexpected extra\n",
    );

    const result = compareLayoutFiles(dir, file, 1);

    expect(result.success).toBe(false);
    expect(result.breakMismatches).toBe(1);
    expect(result.outOfTolerance).toBe(1);
    expect(result.unclaimed).toBe(1);
  });

  it("counts a missing Google slide as unmatched instead of passing an empty comparison", () => {
    const dir = layoutDir([
      { text: "No readback", x: 10, right: 100, baseline: 50 },
    ]);
    const file = googleFile("");

    const result = compareLayoutFiles(dir, file, 1);

    expect(result).toMatchObject({
      lines: 1,
      unmatched: 1,
      success: false,
    });
  });

  it("rejects malformed rows and incomplete layout dumps", () => {
    const dir = layoutDir([{ text: "Title", x: 10, right: 100, baseline: 50 }]);
    const malformed = googleFile("1|not-a-number|50|100|Title\n");
    expect(() => compareLayoutFiles(dir, malformed, 1)).toThrow(
      /Malformed row/,
    );

    const truncated = googleFile("1|10|50|100|Title\ncorrupt readback\n");
    expect(() => compareLayoutFiles(dir, truncated, 1)).toThrow(
      /Malformed row/,
    );

    const emptyNumeric = googleFile("1||50|100|Title\n");
    expect(() => compareLayoutFiles(dir, emptyNumeric, 1)).toThrow(
      /Malformed row/,
    );

    const incomplete = mkdtempSync(join(tmpdir(), "slides-layout-incomplete-"));
    tempDirs.push(incomplete);
    writeFileSync(join(incomplete, "slide-02.json"), "{}");
    const valid = googleFile("1|10|50|100|Title\n");
    expect(() => compareLayoutFiles(incomplete, valid)).toThrow(
      /contiguous slide-01..N/,
    );
  });
});
