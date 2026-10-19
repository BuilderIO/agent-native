import { expect, test, type Page } from "@playwright/test";

import { createPage, EDITOR, getDocument, gotoEditor } from "./helpers";

const TABLE = [
  "Before the table.",
  "",
  "| Item | State | Notes |",
  "| --- | --- | --- |",
  "| Alpha | Draft | First |",
  "| Beta | Ready | Second |",
  "",
  "After the table.",
].join("\n");

function cell(page: Page, text: string) {
  return page
    .locator(`${EDITOR} :is(td, th)`)
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
}

/** Text of the table cell holding the caret, or null outside a table. */
function caretCell(page: Page) {
  return page.evaluate(() => {
    const node = getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest("td, th")?.textContent ?? null;
  });
}

/** Rows of the saved table, in Markdown or the HTML a browser save writes. */
async function savedTableRows(page: Page, id: string) {
  const { content = "" } = await getDocument(page, id);
  const htmlRows = content.match(/<tr\b/g)?.length ?? 0;
  if (htmlRows) return htmlRows;
  return content
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line)).length;
}

async function openTablePage(page: Page, title: string, content = TABLE) {
  const id = await createPage(page, `${title} ${Date.now()}`, content);
  await gotoEditor(page, id);
  await expect(cell(page, "Alpha")).toBeVisible();
  return id;
}

test.describe("inline table controls", () => {
  test("Escape selects the cell before leaving the editor", async ({
    page,
  }) => {
    await openTablePage(page, "Table escape");
    await cell(page, "Alpha").click();

    await page.keyboard.press("Escape");
    await expect(page.locator(EDITOR)).toBeFocused();
    await expect(page.locator(`${EDITOR} .selectedCell`)).toHaveText("Alpha");

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "More page actions" }),
    ).toBeFocused();

    // The first click back in puts the caret where it lands, not in Alpha.
    await cell(page, "Second").click();
    expect(await caretCell(page)).toBe("Second");
    await page.waitForTimeout(300);
    expect(await caretCell(page)).toBe("Second");
  });

  test("row options follow the hovered row and undo stays in the editor", async ({
    page,
  }) => {
    await openTablePage(page, "Table row menu");
    await cell(page, "Alpha").click();

    // The caret stays in Alpha's row; pointing at Beta moves the row options.
    await cell(page, "Ready").hover();
    const rowOptions = page.getByRole("button", { name: "Row options" });
    const readyBox = (await cell(page, "Ready").boundingBox())!;
    const optionsBox = (await rowOptions.boundingBox())!;
    const optionsMiddle = optionsBox.y + optionsBox.height / 2;
    expect(optionsMiddle).toBeGreaterThan(readyBox.y);
    expect(optionsMiddle).toBeLessThan(readyBox.y + readyBox.height);

    await rowOptions.click();
    await page.getByRole("menuitem", { name: "Delete row" }).click();
    await expect(cell(page, "Beta")).toHaveCount(0);
    await expect(page.locator(EDITOR)).toBeFocused();

    await page.keyboard.press("Control+z");
    await expect(cell(page, "Beta")).toBeVisible();
    await expect(cell(page, "Ready")).toBeVisible();
  });

  test("the click that closes a table menu lands where it was aimed", async ({
    page,
  }) => {
    await openTablePage(page, "Table menu dismiss");
    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await expect(page.getByRole("menu")).toBeVisible();

    await cell(page, "First").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await caretCell(page)).toBe("First");
    await page.waitForTimeout(300);
    expect(await caretCell(page)).toBe("First");
  });

  test("table and block menu edits survive a reload", async ({ page }) => {
    const id = await openTablePage(page, "Table persistence");
    expect(await savedTableRows(page, id)).toBe(3);

    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitem", { name: "Insert below" }).click();
    await expect(page.locator(`${EDITOR} tr`)).toHaveCount(4);
    await expect.poll(() => savedTableRows(page, id)).toBe(4);
    await page.reload();
    await expect(page.locator(`${EDITOR} tr`)).toHaveCount(4);

    await cell(page, "Alpha").hover();
    await page
      .locator('[aria-label="Open block menu or drag to reorder"]')
      .click();
    await page.getByRole("menu").getByText("Delete", { exact: true }).click();
    await expect(page.locator(`${EDITOR} table`)).toHaveCount(0);
    await expect.poll(() => savedTableRows(page, id)).toBe(0);
    await page.reload();
    await expect(page.getByText("After the table.")).toBeVisible();
    await expect(page.locator(`${EDITOR} table`)).toHaveCount(0);
  });

  test("a table wider than a phone keeps its add-column control on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const columns = ["Item", "State", "Owner", "Due", "Notes", "Link"];
    await openTablePage(
      page,
      "Table phone",
      [
        `| ${columns.join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        `| Alpha | Draft | Someone | Friday | A longer note | example |`,
      ].join("\n"),
    );
    const table = page.locator(`${EDITOR} table`);
    expect((await table.boundingBox())!.width).toBeGreaterThan(390);

    // Point at the cell the screen's edge cuts through.
    const edgeCell = await page.evaluate(
      ({ editor }) => {
        const cells = [
          ...document.querySelectorAll<HTMLElement>(
            `${editor} tr:last-child td`,
          ),
        ];
        const cut = cells.find((td) => {
          const box = td.getBoundingClientRect();
          return box.left < window.innerWidth && box.right > window.innerWidth;
        });
        return cut?.textContent ?? null;
      },
      { editor: EDITOR },
    );
    expect(edgeCell).not.toBeNull();
    const edgeBox = (await cell(page, edgeCell!).boundingBox())!;
    await page.mouse.move(380, edgeBox.y + edgeBox.height / 2);

    const addColumn = page.getByTestId("table-column-handle");
    const addBox = (await addColumn.boundingBox())!;
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(390);
    await addColumn.click();
    await expect(
      page.locator(`${EDITOR} tr:first-child :is(td, th)`),
    ).toHaveCount(7);
  });
});
