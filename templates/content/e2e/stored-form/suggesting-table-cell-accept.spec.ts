import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_EDITOR,
  createPage,
  expectEditorReady,
  getDocument,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

test.describe.configure({ retries: 0, timeout: 120_000 });

const BODY = [
  "Opening words of the page.",
  "",
  "| Name | Status |",
  "| --- | --- |",
  "| Alpha |  |",
  "| Beta |  |",
].join("\n");

const TYPED = "Shipped";

interface TableEditor {
  state: {
    doc: {
      descendants(
        visit: (
          node: {
            type: { name: string };
            attrs: Record<string, unknown>;
            isTextblock: boolean;
            content: { size: number };
          },
          at: number,
          parent: { type: { name: string } } | null,
        ) => boolean | void,
      ): void;
    };
    tr: {
      setNodeMarkup(
        at: number,
        type: undefined,
        attrs: Record<string, unknown>,
      ): unknown;
    };
  };
  commands: { setTextSelection(at: number): boolean };
  view: { dispatch(tr: unknown): void; focus(): void };
}

const acceptButton = (page: Page) =>
  page.locator('[data-suggestion-decision="accepted"]:not(.ProseMirror *)');

async function resizeColumns(page: Page) {
  await page.evaluate((selector) => {
    const editor = (
      document.querySelector(selector) as
        | (Element & { editor?: TableEditor })
        | null
    )?.editor;
    if (!editor) throw new Error(`No TipTap editor on ${selector}`);
    const { tr } = editor.state;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader")
        tr.setNodeMarkup(at, undefined, { ...node.attrs, colwidth: [180] });
    });
    editor.view.dispatch(tr);
  }, ACTIVE_EDITOR);
}

async function caretInLastEmptyCell(page: Page) {
  await page.evaluate((selector) => {
    const editor = (
      document.querySelector(selector) as
        | (Element & { editor?: TableEditor })
        | null
    )?.editor;
    if (!editor) throw new Error(`No TipTap editor on ${selector}`);
    const empty: number[] = [];
    editor.state.doc.descendants((node, position, parent) => {
      if (
        node.isTextblock &&
        node.content.size === 0 &&
        parent?.type.name === "tableCell"
      )
        empty.push(position + 1);
    });
    if (empty.length === 0) throw new Error("No empty table cell on the page");
    editor.commands.setTextSelection(empty[empty.length - 1]);
    editor.view.focus();
  }, ACTIVE_EDITOR);
}

const statusOf = (page: Page, name: string) =>
  page
    .locator(`${ACTIVE_EDITOR} tr`)
    .filter({ hasText: name })
    .locator("td")
    .nth(1);

test("accepts a suggestion typed into an empty cell of a resized table", async ({
  page,
}) => {
  const id = await createPage(page, "Accept an empty cell", BODY);
  await enterGateArm(page, id);
  await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
  await resizeColumns(page);

  await page.getByRole("button", { name: "More page actions" }).click();
  await page.getByRole("menuitem", { name: "Suggest edits" }).click();
  await expect(
    page.getByRole("button", { name: "Stop suggesting" }),
  ).toBeVisible({ timeout: 30_000 });
  await caretInLastEmptyCell(page);
  await page.keyboard.type(TYPED, { delay: 40 });
  await expect(acceptButton(page)).toHaveCount(1, { timeout: 30_000 });

  await acceptButton(page).click();
  await expect
    .poll(async () => (await getDocument(page, id)).content, {
      message: "the saved page",
      timeout: 30_000,
    })
    .toContain(TYPED);
  await expect(acceptButton(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("were just edited")).toHaveCount(0);
  await expect(statusOf(page, "Beta")).toHaveText(TYPED);
  await expect(statusOf(page, "Alpha")).toHaveText("");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
  await expect(statusOf(page, "Beta")).toHaveText(TYPED);
  await expect(statusOf(page, "Alpha")).toHaveText("");
});
