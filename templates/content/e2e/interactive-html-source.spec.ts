import { expect, test, type Page } from "@playwright/test";

import { createPage, EDITOR, gotoEditor } from "./helpers";

const PAGE = `Paragraph above.

\`\`\`html interactive
<!doctype html><html><head><title>Margin click test</title></head><body><div style="height:300px">Prototype</div></body></html>
\`\`\`

Paragraph below.`;

test.use({ viewport: { width: 1280, height: 830 } });

async function openPage(page: Page, title: string) {
  const id = await createPage(page, `${title} ${Date.now()}`, PAGE);
  await gotoEditor(page, id);
  const block = page.locator(".content-interactive-html");
  await expect(block.locator("iframe")).toBeVisible();
  await expect(block.locator("pre")).toBeHidden();
  return block;
}

async function clickParagraphAbove(page: Page) {
  const box = await page.locator(`${EDITOR} > p`).first().boundingBox();
  if (!box) throw new Error("The paragraph above has no box");
  await page.mouse.click(box.x + 60, box.y + box.height / 2);
}

async function clickBeside(page: Page, block: ReturnType<Page["locator"]>) {
  const box = await block.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("The block has no box");
  const x = Math.min(box.x + box.width + 200, viewport.width - 10);
  await expect
    .poll(() =>
      page.evaluate(
        ([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && !hit.closest(".ProseMirror, button, [role='button']");
        },
        [x, box.y + 20],
      ),
    )
    .toBe(true);
  await page.mouse.click(x, box.y + 20);
}

async function press(block: ReturnType<Page["locator"]>, name: string) {
  const button = block.getByRole("button", { name, exact: true });
  await button.hover();
  const box = await button.boundingBox();
  if (!box) throw new Error(`${name} has no box`);
  await block.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("interactive HTML source", () => {
  test("stays hidden after full screen closes and the page beside it is clicked", async ({
    page,
  }) => {
    const block = await openPage(page, "HTML block full screen");
    await clickParagraphAbove(page);

    await press(block, "Full screen");
    await expect(block).toHaveAttribute("open", "");
    await press(block, "Close full screen");
    await expect(block).not.toHaveAttribute("open");
    await expect(block.locator("pre")).toBeHidden();

    for (let click = 0; click < 3; click++) {
      await clickBeside(page, block);
      await expect(block.locator("pre")).toBeHidden();
      await expect(block).not.toHaveAttribute("open");
    }
  });

  test("stays hidden after Hide source and a click beside the block", async ({
    page,
  }) => {
    const block = await openPage(page, "HTML block hidden source");
    await clickParagraphAbove(page);

    await press(block, "Show source");
    await expect(block.locator("pre")).toBeVisible();
    await press(block, "Hide source");
    await expect(block.locator("pre")).toBeHidden();
    await expect(page.locator(".ProseMirror-selectednode")).toHaveCount(1);

    await clickBeside(page, block);
    await expect(block.locator("pre")).toBeHidden();
    await expect(page.locator(".ProseMirror-selectednode")).toHaveCount(0);
    await expect(
      block.getByRole("button", { name: "Show source" }),
    ).toHaveCount(1);
  });

  test("stays hidden when Escape closes full screen after Hide source", async ({
    page,
  }) => {
    const block = await openPage(page, "HTML block Escape");
    await clickParagraphAbove(page);
    await press(block, "Show source");
    await press(block, "Hide source");
    await expect(block.locator("pre")).toBeHidden();

    await press(block, "Full screen");
    await expect(block).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(block).not.toHaveAttribute("open");
    await expect(block.locator("pre")).toBeHidden();

    await clickBeside(page, block);
    await expect(block.locator("pre")).toBeHidden();
    await expect(block).not.toHaveAttribute("open");
  });
});
