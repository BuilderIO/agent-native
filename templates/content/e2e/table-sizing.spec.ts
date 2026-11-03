import { expect, test, type Page } from "@playwright/test";

import { createPage, EDITOR, gotoEditor } from "./helpers";

const pr = (n: number) =>
  `[#${n}](https://github.com/BuilderIO/agent-native/pull/${n})`;

// The page that showed links squeezed to a character or two per line.
const REVIEW = [
  "Before the table.",
  "",
  "| PR | What it does | Recommendation |",
  "| --- | --- | --- |",
  `| ${pr(7781)} | Draft recovery keeps newer page text and your Oct 20 title choices | Rebase, run CI, land first |`,
  `| ${pr(7788)} | Refuses discarded recovery edits that main left half-settled | Land after #7781 |`,
  `| ${pr(7790)} | Sends a closed tab's later typing to Version History instead of reviving discarded edits | Fix its red bot finding, land after #7788 |`,
  `| ${pr(7729)} | A second tab no longer wipes the first tab's unsaved text | Test on main first; land if the loss still happens |`,
  "",
  "After the table.",
].join("\n");

const NUMBERS = [
  "Before the table.",
  "",
  "| Week | Visitors | Sign-ups | Activated | Weekly active | Retention | Docs views |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| Oct 5 | 12,480 | 1,032 | 418 | 2,911 | 41.2% | 8,320 |",
  "| Oct 12 | 13,115 | 1,104 | 452 | 3,087 | 41.9% | 8,744 |",
  "",
  "After the table.",
].join("\n");

const LONG = [
  "| Kind | Example |",
  "| --- | --- |",
  "| URL | [https://github.com/BuilderIO/agent-native/blob/main/templates/content/app/components/editor/table-view.ts](https://github.com/BuilderIO/agent-native/blob/main/templates/content/app/components/editor/table-view.ts) |",
  `| Short link | ${pr(8152)} |`,
].join("\n");

async function openTable(page: Page, title: string, content: string) {
  const id = await createPage(page, `${title} ${Date.now()}`, content);
  await gotoEditor(page, id);
  const table = page.locator(`${EDITOR} table`);
  await expect(table).toHaveAttribute(
    "data-column-sizing",
    /^(measured|cards)$/,
  );
  return table;
}

/** How many lines each link in the table takes. */
function linkLines(page: Page) {
  return page
    .locator(`${EDITOR} table a`)
    .evaluateAll((links) =>
      links.map(
        (link) =>
          new Set(
            [...link.getClientRects()]
              .filter((rect) => rect.width > 0.5)
              .map((rect) => Math.round(rect.top)),
          ).size,
      ),
    );
}

function scrolls(page: Page) {
  return page.locator(`${EDITOR} .tableWrapper`).evaluate((wrapper) => ({
    overflow: wrapper.scrollWidth - wrapper.clientWidth,
    cue: wrapper.hasAttribute("data-table-scrolls"),
  }));
}

test.describe("content-sized table columns", () => {
  test("short links stay whole and the table fits the page", async ({
    page,
  }) => {
    await openTable(page, "Table sizing review", REVIEW);

    expect(await linkLines(page)).toEqual([1, 1, 1, 1]);
    const { overflow, cue } = await scrolls(page);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(cue).toBe(false);
  });

  test("a long URL breaks inside its column; a short link stays whole", async ({
    page,
  }) => {
    await openTable(page, "Table sizing long", LONG);

    const [url, short] = await linkLines(page);
    expect(url).toBeGreaterThan(1);
    expect(short).toBe(1);
    expect((await scrolls(page)).overflow).toBeLessThanOrEqual(1);
  });

  test("typing in a cell holds the columns until the caret leaves", async ({
    page,
  }) => {
    const table = await openTable(page, "Table sizing hold", REVIEW);
    const widths = () =>
      table.evaluate((element) =>
        [...element.querySelectorAll("col")].map((col) => col.style.width),
      );
    const before = await widths();

    // The PR column is as wide as its links; more text in it needs more room.
    const cell = page.locator(`${EDITOR} td`).first();
    const box = (await cell.boundingBox())!;
    await cell.click({ position: { x: box.width - 6, y: box.height / 2 } });
    await page.keyboard.press("End");
    await page.keyboard.type(" and #7790 too");
    await expect(cell).toHaveText("#7781 and #7790 too");
    await expect.poll(widths).toEqual(before);

    await page.locator(EDITOR).getByText("After the table.").click();
    await expect
      .poll(async () => Number.parseFloat((await widths())[0]))
      .toBeGreaterThan(Number.parseFloat(before[0]) + 20);
  });
});

test.describe("content-sized table columns on a phone", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("a table of sentences shows each row as a card, labelled by its headers", async ({
    page,
  }) => {
    const table = await openTable(page, "Table sizing cards", REVIEW);
    await expect(table).toHaveAttribute("data-column-sizing", "cards");

    // Nothing scrolls sideways, and every value has its column's header.
    expect((await scrolls(page)).overflow).toBeLessThanOrEqual(1);
    const labels = await page
      .locator(`${EDITOR} tr:nth-child(2) td`)
      .evaluateAll((cells) =>
        cells.map((cell) =>
          getComputedStyle(cell, "::before").display === "none"
            ? null
            : cell.getAttribute("data-label"),
        ),
      );
    expect(labels).toEqual([null, "What it does", "Recommendation"]);
    expect(await linkLines(page)).toEqual([1, 1, 1, 1]);
  });

  test("a card's values and its headers can still be edited", async ({
    page,
  }) => {
    const table = await openTable(page, "Table sizing card edit", REVIEW);
    await expect(table).toHaveAttribute("data-column-sizing", "cards");

    // While editing, the header row stays, as a card of its own, and the
    // labels follow it.
    const header = page
      .locator(`${EDITOR} th`)
      .filter({ hasText: /^What it does$/ });
    await expect(header).toBeVisible();
    await header.tap();
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    await expect(page.locator(`${EDITOR} td`).nth(1)).toHaveAttribute(
      "data-label",
      "What it does now",
    );

    // #7788's recommendation.
    const value = page.locator(`${EDITOR} tr`).nth(2).locator("td").nth(2);
    await expect(value).toHaveText("Land after #7781");
    await value.tap();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await expect(value).toHaveText("Land after #7781 today");
    await expect(table).toHaveAttribute("data-column-sizing", "cards");
  });

  test("a table of short values scrolls sideways with a shadow instead", async ({
    page,
  }) => {
    const table = await openTable(page, "Table sizing numbers", NUMBERS);
    await expect(table).toHaveAttribute("data-column-sizing", "measured");

    const { overflow, cue } = await scrolls(page);
    expect(overflow).toBeGreaterThan(0);
    expect(cue).toBe(true);
    // No number wraps.
    const tallest = await page
      .locator(`${EDITOR} tr:last-child td`)
      .evaluateAll((cells) =>
        Math.max(...cells.map((cell) => cell.getBoundingClientRect().height)),
      );
    const shortest = await page
      .locator(`${EDITOR} tr:last-child td`)
      .evaluateAll((cells) =>
        Math.min(...cells.map((cell) => cell.getBoundingClientRect().height)),
      );
    expect(tallest).toBeLessThanOrEqual(shortest + 1);
  });
});
