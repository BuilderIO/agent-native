import { expect, test, type Page } from "@playwright/test";

import { createPage, EDITOR, getDocument, gotoEditor } from "./helpers";

const PARAGRAPH = "Paragraph block for the block menu.";

const PAGE = `${PARAGRAPH}

### Heading three`;

function firstBlock(page: Page) {
  return page.locator(`${EDITOR} > *`).first();
}

/** Characters between the start of the first block and the caret. */
function caretOffsetInFirstBlock(page: Page) {
  return page.evaluate((editor) => {
    const selection = getSelection();
    const block = document.querySelector(editor)?.firstElementChild;
    if (!selection?.anchorNode || !block?.contains(selection.anchorNode)) {
      return null;
    }
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
  }, EDITOR);
}

async function savedBody(page: Page, id: string) {
  return (await getDocument(page, id)).content ?? "";
}

const savedAsHeading = /### Paragraph block|<h3[^>]*>Paragraph block/;

async function openPage(page: Page, title: string) {
  const id = await createPage(page, `${title} ${Date.now()}`, PAGE);
  await gotoEditor(page, id);
  await expect(firstBlock(page)).toHaveText(PARAGRAPH);
  return id;
}

/**
 * Collaborative undo merges changes made within 500 ms into one step, so a
 * command picked faster than a person could pick it would undo along with
 * its typed query and hide whether the query still comes back on its own.
 */
async function pauseLikeAPerson(page: Page) {
  await page.waitForTimeout(600);
}

async function expectParagraphRestored(page: Page) {
  await expect(firstBlock(page)).toHaveText(PARAGRAPH);
  expect(await firstBlock(page).evaluate((node) => node.tagName)).toBe("P");
  expect(await caretOffsetInFirstBlock(page)).toBe(0);
}

test.describe("slash command undo", () => {
  test("one undo turns a slash heading back into its paragraph", async ({
    page,
  }) => {
    const id = await openPage(page, "Slash undo");
    await firstBlock(page).click();
    await page.keyboard.press("Home");
    await page.keyboard.type("/heading 3");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await pauseLikeAPerson(page);
    await page.keyboard.press("Enter");
    await expect(page.locator(`${EDITOR} h3`).first()).toHaveText(PARAGRAPH);
    await expect.poll(() => savedBody(page, id)).toMatch(savedAsHeading);

    await page.keyboard.press("ControlOrMeta+z");
    await expectParagraphRestored(page);

    // The typed query left with the command, so a second undo has nothing
    // of this paragraph's to take back.
    await page.keyboard.press("ControlOrMeta+z");
    await expectParagraphRestored(page);

    await expect.poll(() => savedBody(page, id)).not.toMatch(savedAsHeading);
    expect(await savedBody(page, id)).toContain(PARAGRAPH);
    await page.reload();
    await expect(firstBlock(page)).toHaveText(PARAGRAPH);
    expect(await firstBlock(page).evaluate((node) => node.tagName)).toBe("P");
  });

  test("an undo keeps the typing just before a command picked at once", async ({
    page,
  }) => {
    await openPage(page, "Slash undo without a pause");
    await firstBlock(page).click();
    await page.keyboard.press("Home");
    await page.keyboard.type("Intro ");
    await page.keyboard.press("Home");
    await page.keyboard.type("/heading 3");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${EDITOR} h3`).first()).toHaveText(
      `Intro ${PARAGRAPH}`,
    );

    await page.keyboard.press("ControlOrMeta+z");
    await expect(firstBlock(page)).toHaveText(`Intro ${PARAGRAPH}`);
    expect(await firstBlock(page).evaluate((node) => node.tagName)).toBe("P");
    expect(await caretOffsetInFirstBlock(page)).toBe(0);
  });
});

test.describe("slash command undo on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("a tapped slash command undoes in one step", async ({ page }) => {
    await openPage(page, "Slash undo touch");
    await firstBlock(page).tap();
    await page.keyboard.press("Home");
    await page.keyboard.type("/heading 3");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await pauseLikeAPerson(page);
    await page
      .locator(".slash-command-menu")
      .getByRole("button", { name: /Heading 3/ })
      .tap();
    await expect(page.locator(`${EDITOR} h3`).first()).toHaveText(PARAGRAPH);

    await page.keyboard.press("ControlOrMeta+z");
    await expectParagraphRestored(page);
  });
});
