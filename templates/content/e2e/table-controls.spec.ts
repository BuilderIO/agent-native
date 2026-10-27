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

const GRIP = '[aria-label="Open block menu or drag to reorder"]';

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

/**
 * Texts of the table's cells that match `selector`, without a remote caret's
 * label. A reloaded page still shows the previous tab's caret, whose label
 * sits inside the cell it was in, until the server lets that tab go.
 */
function cellTexts(page: Page, selector: string) {
  return page.locator(`${EDITOR} ${selector}`).evaluateAll((cells) =>
    cells.map((cell) => {
      const copy = cell.cloneNode(true) as Element;
      copy
        .querySelectorAll(
          ".collaboration-carets__caret,.collaboration-carets__label,.ProseMirror-yjs-cursor",
        )
        .forEach((node) => node.remove());
      return copy.textContent ?? "";
    }),
  );
}

/** Rendered widths of the cells in the table's first row. */
function columnWidths(page: Page) {
  return page.evaluate(
    (editor) =>
      [
        ...document.querySelectorAll(`${editor} tr:first-child :is(td, th)`),
      ].map((td) => td.getBoundingClientRect().width),
    EDITOR,
  );
}

/** Whether keyboard focus is still inside the open menu. */
function focusIsInMenu(page: Page) {
  return page.evaluate(
    () => !!document.activeElement?.closest("[role='menu']"),
  );
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
    const rowOptions = page.getByRole("button", {
      exact: true,
      name: "Row options",
    });
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

  test("opening the column menu closes the row menu", async ({ page }) => {
    await openTablePage(page, "Table two menus");
    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete row" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Column options" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete column" }),
    ).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(1);
    await expect.poll(() => focusIsInMenu(page)).toBe(true);
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
    await page.locator(GRIP).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.locator(`${EDITOR} table`)).toHaveCount(0);
    await expect.poll(() => savedTableRows(page, id)).toBe(0);
    await page.reload();
    await expect(page.getByText("After the table.")).toBeVisible();
    await expect(page.locator(`${EDITOR} table`)).toHaveCount(0);
  });

  test("a menu opened from the keyboard acts on the hovered row", async ({
    page,
  }) => {
    await openTablePage(page, "Table keyboard menu");
    await cell(page, "Alpha").click();

    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menuitem", { name: "Delete row" }).click();
    await expect(cell(page, "Beta")).toHaveCount(0);
    await expect(cell(page, "Alpha")).toBeVisible();
  });

  test("the header switches keep their menu open and are saved", async ({
    page,
  }) => {
    const id = await openTablePage(page, "Table headers");
    const savedContent = async () => (await getDocument(page, id)).content;

    await cell(page, "Item").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Header row" }).click();
    await expect(page.getByTestId("header-row-switch")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    await expect(page.getByRole("menu")).toBeVisible();
    await expect.poll(() => focusIsInMenu(page)).toBe(true);

    // From the keyboard too: on, then off again, without the menu closing.
    const headerRowSwitch = page.getByTestId("header-row-switch");
    await page.keyboard.press("Enter");
    await expect(headerRowSwitch).toHaveAttribute("data-state", "checked");
    await page.keyboard.press("Enter");
    await expect(headerRowSwitch).toHaveAttribute("data-state", "unchecked");
    await expect.poll(() => focusIsInMenu(page)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(savedContent).toContain("<table>");

    await cell(page, "Alpha").hover();
    await page.getByRole("button", { name: "Column options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Header column" }).click();
    await expect(page.getByTestId("header-column-switch")).toHaveAttribute(
      "data-state",
      "checked",
    );
    await expect(page.getByRole("menu")).toBeVisible();
    await expect.poll(() => focusIsInMenu(page)).toBe(true);
    await expect.poll(savedContent).toContain('<table header-column="true">');

    await page.reload();
    await expect
      .poll(() => cellTexts(page, ".content-table-header-cell"))
      .toEqual(["Item", "Alpha", "Beta"]);
  });

  test("the table's block menu sets its headers and width, and they are saved", async ({
    page,
  }) => {
    const id = await openTablePage(page, "Table block menu");
    const savedContent = async () => (await getDocument(page, id)).content;

    await cell(page, "Alpha").hover();
    await page.locator(GRIP).click();
    const menu = page.getByRole("menu", { name: "Block actions" });
    const switchNamed = (name: string) =>
      menu.getByRole("menuitemcheckbox", { name });
    await expect(switchNamed("Header row")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await switchNamed("Header column").click();
    await switchNamed("Fit to width").click();
    await expect(switchNamed("Header column")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(switchNamed("Fit to width")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect
      .poll(savedContent)
      .toContain(
        '<table fit-page-width="true" header-row="true" header-column="true">',
      );

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.reload();
    await expect
      .poll(() => cellTexts(page, 'th[scope="col"]'))
      .toEqual(["Item", "State", "Notes"]);
    await expect
      .poll(() => cellTexts(page, 'th[scope="row"]'))
      .toEqual(["Alpha", "Beta"]);
    const tableBox = (await page.locator(`${EDITOR} table`).boundingBox())!;
    const textBox = (await page.getByText("Before the table.").boundingBox())!;
    expect(Math.abs(tableBox.width - textBox.width)).toBeLessThanOrEqual(1);
  });

  test("a duplicated table's block menu acts on the copy", async ({ page }) => {
    await openTablePage(page, "Table duplicate menu");
    const tables = page.locator(`${EDITOR} table`);
    await cell(page, "Alpha").hover();
    await page.locator(GRIP).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(tables).toHaveCount(2);

    await tables.nth(1).locator("td").first().hover();
    await page.locator(GRIP).click();
    await page.getByRole("menuitemcheckbox", { name: "Fit to width" }).click();
    await expect(tables.nth(1)).toHaveAttribute("data-fit-page-width", "true");
    await expect(tables.nth(0)).not.toHaveAttribute("data-fit-page-width");
  });

  test("the block menu closes when a collaborator changes its table, not another block", async ({
    context,
    page,
  }) => {
    const id = await openTablePage(page, "Table menu peer edit");
    const peer = await context.newPage();
    await gotoEditor(peer, id);
    await expect(cell(peer, "Alpha")).toBeVisible();

    await cell(page, "Alpha").hover();
    await page.locator(GRIP).click();
    const menu = page.getByRole("menu", { name: "Block actions" });
    await expect(menu).toBeVisible();

    await peer.getByText("After the table.").click();
    await peer.keyboard.press("End");
    await peer.keyboard.type(" More.");
    await expect(page.getByText("After the table. More.")).toBeVisible();
    await expect(menu).toBeVisible();

    await cell(peer, "Beta").click();
    await peer.keyboard.press("End");
    await peer.keyboard.type("!");
    // The cell also shows the collaborator's caret label.
    await expect(
      page.locator(`${EDITOR} td`, { hasText: "Beta!" }),
    ).toBeVisible();
    await expect(menu).toHaveCount(0);
  });

  test("row and column colours are saved", async ({ page }) => {
    const id = await openTablePage(page, "Table colours");
    const savedContent = async () => (await getDocument(page, id)).content;

    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await page.getByRole("menuitem", { name: "Color" }).hover();
    await page.getByRole("menuitemradio", { name: "Blue background" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The last column's Color submenu opens to the left. A submenu stays open
    // for a pointer on its way to it, not for one that jumps there.
    await cell(page, "First").hover();
    await page.getByRole("button", { name: "Column options" }).click();
    await page.getByRole("menuitem", { name: "Color" }).hover();
    const red = page.getByRole("menuitemradio", { name: "Red text" });
    const redBox = (await red.boundingBox())!;
    await page.mouse.move(
      redBox.x + redBox.width / 2,
      redBox.y + redBox.height / 2,
      { steps: 8 },
    );
    await red.click();

    await expect.poll(savedContent).toContain('<tr color="blue_bg">');
    await expect.poll(savedContent).toContain('<col color="red"/>');
    await page.reload();
    await expect(
      page.locator(`${EDITOR} tr.content-block-bg--blue`),
    ).toHaveText(/Beta/);
    const notesCell = (row: string) =>
      page
        .locator(`${EDITOR} tr`, { hasText: row })
        .locator(":is(td, th)")
        .last();
    // A row's own colour covers its column's.
    await expect(notesCell("Alpha")).toHaveClass(/content-block-color--red/);
    await expect(notesCell("Beta")).not.toHaveClass(/content-block-color--red/);
  });

  test("a colour can be chosen from the keyboard", async ({ page }) => {
    const id = await openTablePage(page, "Table colour keys");

    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menuitem", { name: "Color" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("menuitemradio", { name: "Default text" }),
    ).toBeFocused();
    await page.keyboard.type("Gray b");
    await expect(
      page.getByRole("menuitemradio", { name: "Gray background" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect
      .poll(async () => (await getDocument(page, id)).content)
      .toContain('<tr color="gray_bg">');
  });

  test("Escape closes a table menu within 100 ms", async ({ page }) => {
    await openTablePage(page, "Table menu escape");
    await cell(page, "Ready").hover();
    await page.getByRole("button", { name: "Row options" }).click();
    await expect(page.getByRole("menu")).toBeVisible();

    await page.evaluate(() => {
      const target = window as unknown as { menuClosed?: Promise<number> };
      target.menuClosed = new Promise((resolve) => {
        let start = 0;
        addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Escape") start = performance.now();
          },
          { capture: true, once: true },
        );
        const observer = new MutationObserver(() => {
          if (!start || document.querySelector("[role='menu']")) return;
          observer.disconnect();
          resolve(performance.now() - start);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });
    await page.keyboard.press("Escape");
    const closedAfter = await page.evaluate(
      () => (window as unknown as { menuClosed: Promise<number> }).menuClosed,
    );
    expect(closedAfter).toBeLessThan(100);
  });

  test("Enter and Space on the add controls add a column and a row", async ({
    page,
  }) => {
    await openTablePage(page, "Table add keys");
    const headerCells = page.locator(`${EDITOR} tr:first-child :is(td, th)`);

    await page.getByTestId("table-column-handle").focus();
    await page.keyboard.press("Enter");
    await expect(headerCells).toHaveCount(4);
    await page.keyboard.press("Space");
    await expect(headerCells).toHaveCount(5);

    await page.getByTestId("table-row-handle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${EDITOR} tr`)).toHaveCount(4);
  });

  test("adding a column leaves the caret where it was", async ({ page }) => {
    await openTablePage(page, "Table add caret");
    await cell(page, "Alpha").click();

    await cell(page, "First").hover();
    await page.getByTestId("table-column-handle").click();
    await expect(
      page.locator(`${EDITOR} tr:first-child :is(td, th)`),
    ).toHaveCount(4);
    expect(await caretCell(page)).toBe("Alpha");
    await expect(page.locator(`${EDITOR} .selectedCell`)).toHaveCount(0);
  });

  test("a cell selection shows no text formatting toolbar", async ({
    page,
  }) => {
    await openTablePage(page, "Table cell selection");
    const from = (await cell(page, "Alpha").boundingBox())!;
    const to = (await cell(page, "Ready").boundingBox())!;

    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator(`${EDITOR} .selectedCell`)).toHaveCount(4);
    await page.waitForTimeout(300);
    await expect(page.locator(".bubble-toolbar")).toBeHidden();
  });

  test("the row and column handles stay while the caret is in a cell", async ({
    page,
  }) => {
    await openTablePage(page, "Table caret handles");
    await cell(page, "Ready").click();
    await page.mouse.move(5, 5);

    await expect(page.getByRole("button", { name: "Row options" })).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(
      page.getByRole("button", { name: "Column options" }),
    ).toHaveCSS("opacity", "1");
  });

  test("the block grip stays on screen at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTablePage(page, "Table phone grip");

    await page.getByText("Before the table.").hover();
    const grip = page.locator(GRIP);
    await expect(grip).toHaveCSS("opacity", "1");
    expect((await grip.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  });

  test("at phone width the row options leave the block grip and the cell's text clear", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTablePage(page, "Table phone grip clearance");
    await cell(page, "Item").click();

    const grip = page.locator(GRIP);
    await expect(grip).toHaveCSS("opacity", "1");
    const rowOptions = page.getByRole("button", { name: "Row options" });
    await expect(rowOptions).toHaveCSS("opacity", "1");
    const topmost = (box: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) =>
      page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x, y)
            ?.closest("button, [role=button]")
            ?.getAttribute("aria-label") ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
    expect(await topmost((await grip.boundingBox())!)).toBe(
      "Open block menu or drag to reorder",
    );
    expect(await topmost((await rowOptions.boundingBox())!)).toBe(
      "Row options",
    );

    const textLeft = await cell(page, "Item").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().left;
    });
    const optionsBox = (await rowOptions.boundingBox())!;
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(textLeft);

    await grip.click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Header row" }),
    ).toBeVisible();
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
    await page.mouse.move(edgeBox.x + 5, edgeBox.y + edgeBox.height / 2);

    const addColumn = page.getByTestId("table-column-handle");
    const addBox = (await addColumn.boundingBox())!;
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(390);
    await addColumn.click();
    await expect(
      page.locator(`${EDITOR} tr:first-child :is(td, th)`),
    ).toHaveCount(7);
  });

  test("a content-sized table's border moves only when dragged, and one undo puts it back", async ({
    page,
  }) => {
    await openTablePage(page, "Table border drag");
    const table = page.locator(`${EDITOR} table`);
    await page.locator(EDITOR).getByText("Before the table.").click();
    await expect(table).toHaveAttribute("data-column-sizing", "content");
    const before = await columnWidths(page);
    const item = (await cell(page, "Item").boundingBox())!;
    const border = { x: item.x + item.width - 1, y: item.y + item.height / 2 };
    await page.mouse.move(border.x - 20, border.y);
    await page.mouse.move(border.x, border.y);

    // A press on the border that doesn't drag it stores no widths.
    await page.mouse.down();
    await page.mouse.up();
    await expect(table).toHaveAttribute("data-column-sizing", "content");

    // The drag lasts longer than undo's grouping window, so the widths it
    // stores have to join the drag's own undo step.
    await page.mouse.down();
    await page.mouse.move(border.x + 20, border.y, { steps: 4 });
    await page.waitForTimeout(700); // e2e-harness-ignore: the drag must outlast undo's 500 ms grouping window
    await page.mouse.move(border.x + 40, border.y, { steps: 4 });
    await page.mouse.up();
    await expect(table).not.toHaveAttribute("data-column-sizing");
    const after = await columnWidths(page);
    expect(Math.abs(after[0] - before[0] - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(after[1] - before[1] + 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(after[2] - before[2])).toBeLessThanOrEqual(2);

    await page.keyboard.press("Control+z");
    await expect(table).toHaveAttribute(
      "data-column-sizing",
      /^(content|held)$/,
    );
    const undone = await columnWidths(page);
    undone.forEach((width, index) =>
      expect(Math.abs(width - before[index])).toBeLessThanOrEqual(1),
    );
  });
});

test.describe("inline table controls on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("taps open the table's menus and set its width and colours", async ({
    page,
  }) => {
    const id = await openTablePage(page, "Table touch menus");
    const savedContent = async () => (await getDocument(page, id)).content;

    await cell(page, "Alpha").tap();
    await page.locator(GRIP).tap();
    const fit = page.getByRole("menuitemcheckbox", { name: "Fit to width" });
    await fit.tap();
    await expect(fit).toHaveAttribute("aria-checked", "true");
    await expect.poll(savedContent).toContain('fit-page-width="true"');
    await page.getByRole("menuitem", { name: "Insert block below" }).tap();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await cell(page, "Ready").tap();
    await page.getByRole("button", { name: "Row options" }).tap();
    await page.getByRole("menuitem", { name: "Color" }).tap();
    await page.getByRole("menuitemradio", { name: "Green background" }).tap();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(savedContent).toContain('<tr color="green_bg">');
  });

  test("a tap on the cell under the hidden add-column control edits that cell", async ({
    page,
  }) => {
    const columns = ["Item", "State", "Owner", "Due", "Notes", "Link"];
    await openTablePage(
      page,
      "Table touch",
      [
        `| ${columns.join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        `| Alpha | Draft | Someone | Friday | A longer note | first |`,
        `| Beta | Ready | Someone | Monday | Another note | second |`,
      ].join("\n"),
    );
    const headerCells = page.locator(`${EDITOR} tr:first-child :is(td, th)`);
    const addColumn = page.getByTestId("table-column-handle");

    // The control sits over the scrollport's edge. Columns sized to their
    // content can put a border there too, and a tap beside a border may land
    // in the next cell, so the tap goes where the control is farthest from one.
    const addBox = (await addColumn.boundingBox())!;
    const y = addBox.y + addBox.height / 2;
    const { x, tappedCell } = await page.evaluate(
      ({ editor, left, right, y }) => {
        const cells = [
          ...document.querySelectorAll(`${editor} td, ${editor} th`),
        ].map((td) => ({ td, box: td.getBoundingClientRect() }));
        const row = cells.filter(({ box }) => box.top <= y && y <= box.bottom);
        const borders = row.flatMap(({ box }) => [box.left, box.right]);
        // Only the part of the control over the table's visible area.
        const visible = row[0]?.td
          .closest(".tableWrapper")
          ?.getBoundingClientRect();
        const from = Math.max(left, visible?.left ?? left) + 2;
        const to = Math.min(right, visible?.right ?? right) - 2;
        let best = from;
        let bestGap = -1;
        for (let x = from; x <= to; x += 0.5) {
          const gap = Math.min(...borders.map((edge) => Math.abs(edge - x)));
          if (gap > bestGap) [best, bestGap] = [x, gap];
        }
        const hit = row.find(
          ({ box }) => box.left <= best && best <= box.right,
        );
        return { x: best, tappedCell: hit?.td.textContent ?? null };
      },
      { editor: EDITOR, left: addBox.x, right: addBox.x + addBox.width, y },
    );
    const tap = { x, y };
    expect(tappedCell).not.toBeNull();

    await page.touchscreen.tap(tap.x, tap.y);
    await expect.poll(() => caretCell(page)).toBe(tappedCell);
    await expect(headerCells).toHaveCount(6);

    // The tap shows the control beside that cell, and tapping it adds a column.
    await expect(addColumn).toHaveCSS("opacity", "1");
    await addColumn.tap();
    await expect(headerCells).toHaveCount(7);
  });

  test("a touch on the add-column control that the browser cancels adds nothing", async ({
    page,
  }) => {
    await openTablePage(page, "Table touch cancel");
    const headerCells = page.locator(`${EDITOR} tr:first-child :is(td, th)`);
    await expect(headerCells).toHaveCount(3);

    // The browser cancels a touch it takes over, e.g. to scroll the page.
    await page.getByTestId("table-column-handle").evaluate((handle) => {
      const box = handle.getBoundingClientRect();
      const touch = {
        bubbles: true,
        cancelable: true,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
        isPrimary: true,
        pointerId: 7,
        pointerType: "touch",
      };
      handle.dispatchEvent(new PointerEvent("pointerdown", touch));
      handle.dispatchEvent(new PointerEvent("pointercancel", touch));
    });

    // A later tap elsewhere must not finish the cancelled touch.
    await cell(page, "Alpha").tap();
    expect(await caretCell(page)).toBe("Alpha");
    await page.waitForTimeout(300);
    await expect(headerCells).toHaveCount(3);
  });
});
