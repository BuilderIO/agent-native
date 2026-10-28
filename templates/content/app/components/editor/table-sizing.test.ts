// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  CARD_LAYOUT_MAX_WIDTH,
  cellLabel,
  cellLines,
  columnFloors,
  fairShares,
  labelTableCells,
  planColumns,
  TEXT_COLUMN_FLOOR,
  type MeasuredCell,
  type TableMeasure,
} from "./table-sizing";

// Text in an 8 px font with 4 px spaces, in cells with 24 px of padding.
const CHAR = 8;
const SPACE = 4;
const INSET = 24;

function cell(text: string): MeasuredCell {
  const words = text.split(" ").filter(Boolean);
  return {
    inset: INSET,
    blocks: [
      {
        indent: 0,
        pieces: words.map((word, index) => ({
          width: word.length * CHAR,
          space: index < words.length - 1 ? SPACE : 0,
        })),
      },
    ],
  };
}

/** A measure of `rows` of text, as measureTable would take it. */
function measureOf(rows: string[][]): TableMeasure {
  const cells = rows.map((row) => row.map(cell));
  const columns = rows[0].length;
  const unwrapped = (c: MeasuredCell) =>
    c.blocks[0].pieces.reduce((sum, p) => sum + p.width + p.space, 0);
  const natural = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...cells.map((row) => Math.ceil(INSET + unwrapped(row[column])) + 1),
    ),
  );
  const floor = columnFloors(
    natural.map((_, column) =>
      Math.max(
        ...cells.map(
          (row) =>
            INSET +
            Math.max(
              0,
              ...row[column].blocks[0].pieces.map((p) => p.width + p.space),
            ),
        ),
      ),
    ),
    // The first row is the header.
    natural.map((_, column) =>
      Math.max(...cells.slice(1).map((row) => INSET + unwrapped(row[column]))),
    ),
  );
  const prose = cells
    .slice(1)
    .some((row) => row.some((c) => unwrapped(c) > 2 * TEXT_COLUMN_FLOOR));
  return { natural, floor, rows: cells, prose };
}

const sentence =
  "Draft recovery keeps newer page text and your title choices after a refresh";

const review = measureOf([
  ["PR", "What it does", "Recommendation"],
  ["#7781", sentence, "Rebase, run CI, land first"],
  ["#7788", "Refuses discarded recovery edits", "Land after #7781"],
  ["#7790", sentence, "Fix its red bot finding, land after #7788"],
]);

const numbers = measureOf([
  ["Week", "Visitors", "Sign-ups", "Activated", "Active", "Retention"],
  ["Oct 5", "12,480", "1,032", "418", "2,911", "41.2%"],
  ["Oct 12", "13,115", "1,104", "452", "3,087", "41.9%"],
]);

const total = (widths: number[]) => widths.reduce((sum, w) => sum + w, 0);

describe("planColumns", () => {
  it("gives a short column all it needs and the long ones the rest", () => {
    const plan = planColumns(review, 640);

    expect(plan.layout).toBe("columns");
    expect(total(plan.widths)).toBeCloseTo(640, 1);
    expect(plan.widths[0]).toBeGreaterThanOrEqual(review.natural[0]);
    plan.widths.forEach((width, column) =>
      expect(width).toBeGreaterThanOrEqual(review.floor[column] - 0.01),
    );
  });

  it("gives every column its natural width when they all fit", () => {
    const plan = planColumns(numbers, 2000);

    expect(plan.layout).toBe("columns");
    plan.widths.forEach((width, column) =>
      expect(width).toBeGreaterThanOrEqual(numbers.natural[column]),
    );
  });

  const plans = measureOf([
    ["Plan", "Works offline", "Shared editing", "Paid seat", "Over the API"],
    ["Free", "✓", "✓", "No", "—"],
    ["Enterprise", "✓", "✓", "Yes", "✓"],
  ]);

  it("wraps long headers over short values instead of scrolling", () => {
    // A header's floor is its longest word, not twelve characters.
    expect(plans.floor[2]).toBe(INSET + "editing".length * CHAR + 1);

    const plan = planColumns(plans, 480);
    expect(plan.layout).toBe("columns");
    expect(total(plan.widths)).toBeCloseTo(480, 1);
  });

  it("scrolls when the floors don't fit, without wrapping short headers", () => {
    const plan = planColumns(plans, total(plans.floor) - 50);

    expect(plan.layout).toBe("scroll");
    expect(plan.widths).toEqual(
      plans.natural.map((width) => Math.min(width, TEXT_COLUMN_FLOOR)),
    );
    expect(planColumns(numbers, total(numbers.floor) - 50)).toEqual({
      widths: numbers.floor,
      layout: "scroll",
    });
  });

  it("shows rows as cards only on a phone, and only for sentences", () => {
    expect(review.prose).toBe(true);
    expect(numbers.prose).toBe(false);
    const phone = 291;
    expect(total(review.floor)).toBeGreaterThan(phone);
    expect(total(numbers.floor)).toBeGreaterThan(phone);

    expect(planColumns(review, phone).layout).toBe("cards");
    expect(planColumns(numbers, phone).layout).toBe("scroll");

    // Wider than a phone, sentences that can't fit scroll too.
    const essays = measureOf([
      ["Approach", "How it works", "Where it shines", "Where it hurts"],
      [sentence, sentence, sentence, sentence],
    ]);
    expect(total(essays.floor)).toBeGreaterThan(CARD_LAYOUT_MAX_WIDTH + 40);
    expect(planColumns(essays, CARD_LAYOUT_MAX_WIDTH + 40).layout).toBe(
      "scroll",
    );
    expect(planColumns(essays, phone).layout).toBe("cards");
  });

  it("fits a table set to fit the page width, below its floors if need be", () => {
    const plan = planColumns(review, 291, { fitPageWidth: true });

    expect(plan.layout).toBe("columns");
    expect(total(plan.widths)).toBeCloseTo(291, 1);
  });
});

describe("fairShares", () => {
  it("splits what short columns leave evenly, above each floor", () => {
    const widths = fairShares([100, 500, 500], [100, 128, 128], 700);

    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeCloseTo(300, 0);
    expect(widths[2]).toBeCloseTo(300, 0);
  });
});

describe("cellLines", () => {
  it("keeps each word's space on its line, as break-spaces does", () => {
    // Needs␠ = 44, a␠ = 12, paid␠ = 36, seat = 32.
    const header = cell("Needs a paid seat");

    // "a paid" is 44 px, but the space after "paid" wouldn't fit.
    expect(cellLines(header, INSET + 44)).toBe(4);
    expect(cellLines(header, INSET + 48)).toBe(3);
    expect(cellLines(header, INSET + 136)).toBe(1);
  });
});

describe("labelTableCells", () => {
  it("labels each value with its header and marks empty cells", () => {
    const table = document.createElement("table");
    table.innerHTML =
      "<tbody>" +
      "<tr><th>Name</th><th colspan='2'>Role  and\nteam</th><th>Notes</th></tr>" +
      "<tr><td>Priya</td><td>Design</td><td>Menus</td><td><p></p></td></tr>" +
      "</tbody>";

    labelTableCells(table);

    const [header, row] = Array.from(table.rows);
    expect(header.cells[0].hasAttribute("data-label")).toBe(false);
    expect(
      Array.from(row.cells, (cell) => cell.getAttribute("data-label")),
    ).toEqual(["Name", "Role and team", null, "Notes"]);
    expect(row.cells[3].hasAttribute("data-empty")).toBe(true);
    expect(row.cells[0].hasAttribute("data-empty")).toBe(false);
  });

  it("leaves a table without a header row unlabelled", () => {
    const table = document.createElement("table");
    table.innerHTML = "<tbody><tr><td>A</td><td>B</td></tr></tbody>";

    labelTableCells(table);

    expect(table.rows[0].cells[1].hasAttribute("data-label")).toBe(false);
  });
});

describe("cellLabel", () => {
  it("keeps a label to one short line", () => {
    expect(cellLabel("  Works\n offline ")).toBe("Works offline");
    expect(cellLabel("x".repeat(100))).toHaveLength(80);
  });
});
