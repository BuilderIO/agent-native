import { expect, test, type Page } from "@playwright/test";

import { canonicalizeNfm } from "../../shared/nfm";
import {
  ACTIVE_EDITOR,
  createPage,
  expectEditorReady,
  getDocument,
} from "../helpers";
import { enterGateArm, knownLossOnArm } from "../live-body-gate";

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
    const at = empty.pop();
    if (at === undefined) throw new Error("No empty table cell on the page");
    editor.commands.setTextSelection(at);
    editor.view.focus();
  }, ACTIVE_EDITOR);
}

async function everyColumnSized(page: Page) {
  return page.evaluate((selector) => {
    const editor = (
      document.querySelector(selector) as
        | (Element & { editor?: TableEditor })
        | null
    )?.editor;
    if (!editor) throw new Error(`No TipTap editor on ${selector}`);
    let cells = 0;
    let sized = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "tableCell" && node.type.name !== "tableHeader")
        return;
      cells += 1;
      const { colwidth } = node.attrs;
      if (
        Array.isArray(colwidth) &&
        colwidth.some(
          (width: unknown) => typeof width === "number" && width > 0,
        )
      )
        sized += 1;
    });
    return cells > 0 && sized === cells;
  }, ACTIVE_EDITOR);
}

const statusOf = (page: Page, name: string) =>
  page
    .locator(`${ACTIVE_EDITOR} tr`)
    .filter({ hasText: name })
    .locator("td")
    .nth(1);

test(
  "accepts a suggestion typed into an empty cell of a resized table",
  knownLossOnArm({
    on: {
      lane: "L7",
      reason:
        "On a switched page the live-copy writer refuses the accept as suggestion_unmappable (block layout), because the editor's empty line after a table that ends the page has no span in the stored Markdown; without that line it accepts, but rebuilds the table from Markdown and drops its column widths.",
    },
  }),
  async ({ page }) => {
    const id = await createPage(
      page,
      "Accept an empty cell",
      canonicalizeNfm(BODY),
    );
    await enterGateArm(page, id);
    await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
    await expectEditorReady(page);
    await resizeColumns(page);
    expect(await everyColumnSized(page), "the resize").toBe(true);

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
    expect(await everyColumnSized(page), "the widths after the accept").toBe(
      true,
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectEditorReady(page);
    await expect(statusOf(page, "Beta")).toHaveText(TYPED);
    await expect(statusOf(page, "Alpha")).toHaveText("");
  },
);
