import { expect, test, type Page } from "@playwright/test";

import { createPage, EDITOR, getDocument, gotoEditor } from "./helpers";

const BODY = [
  "First line.",
  "",
  "Second line.",
  "",
  "---",
  "",
  "Third line.",
].join("\n");

const GRIP = '[aria-label="Open block menu or drag to reorder"]';
const SELECTED_BLOCK = `${EDITOR} .ProseMirror-selectednode`;
const MAC = process.platform === "darwin";

/** A top-level block of the page, by its whole text. */
function block(page: Page, text: string) {
  return page
    .locator(`${EDITOR} > *`)
    .filter({ hasText: new RegExp(`^${text.replace(".", "\\.")}$`) })
    .first();
}

async function openPage(page: Page, title: string) {
  const id = await createPage(page, `${title} ${Date.now()}`, BODY);
  await gotoEditor(page, id);
  await expect(block(page, "First line.")).toBeVisible();
  return id;
}

async function openMenu(page: Page, target: ReturnType<typeof block>) {
  await target.hover();
  await page.locator(GRIP).click();
  const menu = page.getByRole("menu", { name: "Block actions" });
  await expect(menu).toBeVisible();
  return menu;
}

function savedContent(page: Page, id: string) {
  return async () => (await getDocument(page, id)).content ?? "";
}

/** Clicks the empty page to the left of the text, clear of the grip. */
async function clickBesidePage(page: Page) {
  const box = (await page.locator(EDITOR).boundingBox())!;
  expect(box.x).toBeGreaterThan(160);
  await page.mouse.click(box.x - 140, box.y + 8);
}

/** Types a comment into the open composer and posts it. */
async function postComment(page: Page, text: string) {
  const comments = page.getByRole("complementary", { name: "Comments" });
  await expect(
    comments.getByRole("textbox", { name: "Add a comment..." }),
  ).toBeFocused();
  await page.keyboard.type(text);
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(comments.getByText(text)).toBeVisible();
  // The posted thread then focuses its reply box, which would close a menu
  // opened before it does.
  await expect(
    comments.getByRole("textbox", { name: "Reply..." }),
  ).toBeFocused();
}

test.describe("block menu", () => {
  test("turns a block into a heading in one undoable step, and it's saved", async ({
    page,
  }) => {
    const id = await openPage(page, "Block turn into");
    const menu = await openMenu(page, block(page, "First line."));
    await expect(menu.getByText("Text", { exact: true })).toBeVisible();

    await menu.getByRole("menuitem", { name: "Turn into" }).hover();
    await expect(
      page.getByRole("menuitemradio", { name: "Text" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Heading 3" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    const heading = page.locator(`${EDITOR} h3`);
    await expect(heading).toHaveText("First line.");
    await expect(page.locator(EDITOR)).toBeFocused();

    await page.keyboard.press("ControlOrMeta+z");
    await expect(heading).toHaveCount(0);
    await expect(block(page, "First line.")).toHaveJSProperty("tagName", "P");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(heading).toHaveText("First line.");

    await expect.poll(savedContent(page, id)).toContain("### First line.");
    await page.reload();
    await expect(page.locator(`${EDITOR} h3`)).toHaveText("First line.");
  });

  test("reaches Turn into from the keyboard", async ({ page }) => {
    await openPage(page, "Block turn into keys");
    await openMenu(page, block(page, "Second line."));

    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "Turn into" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("menuitemradio", { name: "Text" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "Heading 1" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: "Heading 2" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.locator(`${EDITOR} h2`)).toHaveText("Second line.");
  });

  test("colours a block, leaves it ready to type in, and the colour is saved", async ({
    page,
  }) => {
    const id = await openPage(page, "Block colour");
    const menu = await openMenu(page, block(page, "Second line."));

    await menu.getByRole("menuitem", { name: "Color" }).hover();
    await page.getByRole("menuitemradio", { name: "Blue background" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    const coloured = page.locator(`${EDITOR} p[data-notion-color="blue_bg"]`);
    await expect(coloured).toHaveText("Second line.");

    await page.keyboard.type(" Done");
    await expect(coloured).toHaveText("Second line. Done");
    await expect.poll(savedContent(page, id)).toContain("blue_bg");
    await page.reload();
    await expect(
      page.locator(`${EDITOR} p[data-notion-color="blue_bg"]`),
    ).toHaveText("Second line. Done");
  });

  test("filters as you type and runs the first match on Enter", async ({
    page,
  }) => {
    await openPage(page, "Block filter");
    const menu = await openMenu(page, block(page, "First line."));
    await expect(
      menu.getByRole("textbox", { name: "Search actions..." }),
    ).toBeFocused();

    await page.keyboard.type("dup");
    await expect(menu.getByRole("menuitem")).toHaveText([/^Duplicate/]);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
      page.locator(`${EDITOR} > p`, { hasText: /^First line\.$/ }),
    ).toHaveCount(2);
  });

  test("its shortcut hints work in the menu and on the block it selects", async ({
    page,
  }) => {
    await openPage(page, "Block shortcuts");
    const firsts = page.locator(`${EDITOR} > p`, {
      hasText: /^First line\.$/,
    });
    const menu = await openMenu(page, block(page, "First line."));
    await expect(
      menu.getByRole("menuitem", { name: /^Duplicate/ }),
    ).toContainText(MAC ? "⌘D" : "Ctrl+D");
    await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toContainText(
      "Del",
    );

    await page.keyboard.press("ControlOrMeta+d");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(firsts).toHaveCount(2);
    await expect(page.locator(SELECTED_BLOCK)).toHaveText("First line.");

    // The copy is selected, so the same keys copy it again.
    await page.keyboard.press("ControlOrMeta+d");
    await expect(firsts).toHaveCount(3);

    await openMenu(page, block(page, "Second line."));
    await page.keyboard.press("Delete");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(block(page, "Second line.")).toHaveCount(0);
  });

  test("starts a comment on a block from its menu or its shortcut", async ({
    page,
  }) => {
    await openPage(page, "Block comment");
    const menu = await openMenu(page, block(page, "Second line."));
    const comment = menu.getByRole("menuitem", { name: /^Comment/ });
    await expect(comment).toContainText(MAC ? "⇧⌘M" : "Ctrl+Shift+M");

    await comment.click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    const pending = page.locator(`${EDITOR} .comment-highlight--pending`);
    await expect(pending).toHaveText("Second line.");
    await postComment(page, "Worth a look");
    const highlights = page.locator(`${EDITOR} .comment-highlight`);
    await expect(highlights).toHaveText(["Second line."]);

    await openMenu(page, block(page, "Third line."));
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(pending).toHaveText("Third line.");
    await postComment(page, "And this");
    await expect(highlights).toHaveText(["Second line.", "Third line."]);
  });

  test("a click beside the page lets go of a selected block", async ({
    page,
  }) => {
    await openPage(page, "Block deselect");
    const selected = page.locator(SELECTED_BLOCK);

    const menu = await openMenu(page, block(page, "First line."));
    await menu.getByRole("menuitem", { name: /^Duplicate/ }).click();
    await expect(selected).toHaveCount(1);
    await clickBesidePage(page);
    await expect(selected).toHaveCount(0);

    const dividerMenu = await openMenu(page, page.locator(`${EDITOR} hr`));
    await expect(
      dividerMenu.getByText("Divider", { exact: true }),
    ).toBeVisible();
    await expect(selected).toHaveCount(1);
    await clickBesidePage(page);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(selected).toHaveCount(0);
  });
});

test.describe("block menu on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("taps turn a block into a heading and colour another", async ({
    page,
  }) => {
    const id = await openPage(page, "Block touch");
    const menu = page.getByRole("menu", { name: "Block actions" });

    await block(page, "First line.").tap();
    await page.locator(GRIP).tap();
    await expect(menu).toBeVisible();
    // The phone's keyboard stays down until the search is tapped.
    await expect(menu.getByRole("textbox")).not.toBeFocused();
    await menu.getByRole("menuitem", { name: "Turn into" }).tap();
    await page.getByRole("menuitemradio", { name: "Heading 2" }).tap();
    await expect(page.locator(`${EDITOR} h2`)).toHaveText("First line.");

    await block(page, "Second line.").tap();
    await page.locator(GRIP).tap();
    await menu.getByRole("menuitem", { name: "Color" }).tap();
    await page.getByRole("menuitemradio", { name: "Red text" }).tap();
    await expect(
      page.locator(`${EDITOR} p[data-notion-color="red"]`),
    ).toHaveText("Second line.");

    await expect.poll(savedContent(page, id)).toContain("## First line.");
    await expect.poll(savedContent(page, id)).toContain("red");
  });
});
