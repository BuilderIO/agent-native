import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_EDITOR,
  createPage,
  expectEditorReady,
  getDocument,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

// A new line in a code block in Suggesting mode behaves like any other line.
// Saving the Enter draws a "↵" there, and Chrome won't keep a caret between a
// line break and an uneditable element: typing, Backspace, and the arrow keys
// all used to act on the line above. Only a real browser shows this, since
// jsdom has no caret.

test.describe.configure({ retries: 0, timeout: 120_000 });

const FENCE = "```";
const LINES = [
  'const name = "team";',
  "for (const item of items) {",
  "",
  "  log(item);",
  "}",
];
const code = (lines: readonly string[]) => lines.join("\n");
const withLines = (index: number, ...added: string[]) => [
  ...LINES.slice(0, index + 1),
  ...added,
  ...LINES.slice(index + 1),
];

/** The parts of the page's TipTap editor these checks use. */
interface PageEditor {
  state: {
    doc: {
      descendants(
        visit: (
          node: {
            isText: boolean;
            text?: string;
            textContent: string;
            type: { spec: { code?: boolean } };
          },
          at: number,
        ) => void,
      ): void;
    };
  };
  commands: { setTextSelection(at: number): boolean };
  view: { focus(): void };
}

const acceptButton = (page: Page) =>
  page.locator('[data-suggestion-decision="accepted"]:not(.ProseMirror *)');

/** Opens a new page in Suggesting mode, and returns its id. */
async function openSuggesting(page: Page, title: string) {
  const id = await createPage(
    page,
    title,
    `A small script:\n${FENCE}js\n${code(LINES)}\n${FENCE}\nClosing paragraph.`,
  );
  await enterGateArm(page, id);
  await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
  await page.getByRole("button", { name: "More page actions" }).click();
  await page.getByRole("menuitem", { name: "Suggest edits" }).click();
  await expect(
    page.getByRole("button", { name: "Stop suggesting" }),
  ).toBeVisible({ timeout: 30_000 });
  return id;
}

/**
 * Presses Enter at the end of `line`, `times` times, and returns once the
 * editor has drawn the result, which is what used to move the caret.
 */
async function enterAfter(page: Page, line: string, times = 1) {
  await page.evaluate(
    ({ line, selector }) => {
      const editor = (
        document.querySelector(selector) as
          | (Element & { editor?: PageEditor })
          | null
      )?.editor;
      if (!editor) throw new Error(`No TipTap editor on ${selector}`);
      let at: number | null = null;
      editor.state.doc.descendants((node, position) => {
        if (at !== null || !node.isText) return;
        const index = node.text?.indexOf(line) ?? -1;
        if (index >= 0) at = position + index + line.length;
      });
      if (at === null) throw new Error(`No "${line}" on the page`);
      editor.commands.setTextSelection(at);
      editor.view.focus();
    },
    { line, selector: ACTIVE_EDITOR },
  );
  for (let press = 0; press < times; press++)
    await page.keyboard.press("Enter");
  await expect(acceptButton(page)).toHaveCount(1, { timeout: 30_000 });
}

function codeInEditor(page: Page) {
  return page.evaluate((selector) => {
    const editor = (
      document.querySelector(selector) as
        | (Element & { editor?: PageEditor })
        | null
    )?.editor;
    let found: string | null = null;
    editor?.state.doc.descendants((node) => {
      if (found === null && node.type.spec.code) found = node.textContent;
    });
    return found;
  }, ACTIVE_EDITOR);
}

test.describe("a new line in a code block while suggesting", () => {
  const TYPED = [
    {
      name: "before a line that holds text",
      after: LINES[0]!,
      times: 1,
      expected: withLines(0, "added();"),
    },
    {
      name: "before a blank line",
      after: LINES[1]!,
      times: 1,
      expected: withLines(1, "added();"),
    },
    {
      name: "at the end of the block",
      after: LINES[4]!,
      times: 1,
      expected: withLines(4, "added();"),
    },
    {
      name: "below a blank line it also adds",
      after: LINES[0]!,
      times: 2,
      expected: withLines(0, "", "added();"),
    },
  ];

  for (const { name, after, times, expected } of TYPED) {
    test(`keeps what is typed on it, and saves it there, ${name}`, async ({
      page,
    }) => {
      const id = await openSuggesting(page, `Code lines ${name}`);
      await enterAfter(page, after, times);
      await page.keyboard.type("added();", { delay: 40 });
      await expect.poll(() => codeInEditor(page)).toBe(code(expected));

      await acceptButton(page).click();
      await expect
        .poll(async () => (await getDocument(page, id)).content, {
          message: "the saved page",
          timeout: 30_000,
        })
        .toContain(`${FENCE}js\n${code(expected)}\n${FENCE}`);
    });
  }

  test("is marked with its highlight, not an uneditable widget", async ({
    page,
  }) => {
    await openSuggesting(page, "Code lines marked");
    await enterAfter(page, LINES[0]!);
    await expect(
      page.locator(`${ACTIVE_EDITOR} pre .suggestion-line-break`),
    ).toBeVisible();
    await expect(
      page.locator(`${ACTIVE_EDITOR} pre [data-suggestion-widget]`),
    ).toHaveCount(0);
  });

  test("goes away with Backspace, leaving the line above whole", async ({
    page,
  }) => {
    await openSuggesting(page, "Code lines Backspace");
    await enterAfter(page, LINES[0]!);
    await page.keyboard.press("Backspace");
    await expect.poll(() => codeInEditor(page)).toBe(code(LINES));

    await page.keyboard.type("!");
    await expect
      .poll(() => codeInEditor(page))
      .toBe(code([`${LINES[0]}!`, ...LINES.slice(1)]));
  });

  test("can be reached again with the arrow keys", async ({ page }) => {
    await openSuggesting(page, "Code lines arrows");
    await enterAfter(page, LINES[0]!);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("added();", { delay: 40 });
    await expect
      .poll(() => codeInEditor(page))
      .toBe(code(withLines(0, "added();")));
  });

  test("is one ArrowLeft from the end of the line above", async ({ page }) => {
    await openSuggesting(page, "Code lines ArrowLeft");
    await enterAfter(page, LINES[0]!);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("!");
    await expect
      .poll(() => codeInEditor(page))
      .toBe(code([`${LINES[0]}!`, "", ...LINES.slice(1)]));
  });
});
