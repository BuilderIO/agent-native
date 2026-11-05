import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_EDITOR,
  createPage,
  expectEditorReady,
  getDocument,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

// An accepted edit with a line break or a new block can't be drawn in its
// finished form while it saves, so its suggestion stays drawn until the save
// comes back. Nothing may appear above the page in that time: a line of text
// there used to push the page down and back up on every such Accept. Only a
// real browser shows this, since jsdom has no layout.

test.describe.configure({ retries: 0, timeout: 120_000 });

const FENCE = "```";
const BODY = [
  "Opening words of the page.",
  `${FENCE}js`,
  'const name = "team";',
  FENCE,
  "Closing paragraph.",
].join("\n");

const EDITS = [
  { name: "a new code line", after: 'const name = "team";', typed: "added();" },
  {
    name: "a new paragraph",
    after: "Closing paragraph.",
    typed: "A new paragraph.",
  },
  { name: "a split paragraph", after: "Opening words", typed: "typed words" },
];

/** The parts of the page's TipTap editor these checks use. */
interface PageEditor {
  state: {
    doc: {
      descendants(
        visit: (node: { isText: boolean; text?: string }, at: number) => void,
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
  const id = await createPage(page, title, BODY);
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

/** Presses Enter at the end of `after`, then types `typed` on the new line. */
async function suggestLine(page: Page, after: string, typed: string) {
  await page.evaluate(
    ({ after, selector }) => {
      const editor = (
        document.querySelector(selector) as
          | (Element & { editor?: PageEditor })
          | null
      )?.editor;
      if (!editor) throw new Error(`No TipTap editor on ${selector}`);
      let at: number | null = null;
      editor.state.doc.descendants((node, position) => {
        if (at !== null || !node.isText) return;
        const index = node.text?.indexOf(after) ?? -1;
        if (index >= 0) at = position + index + after.length;
      });
      if (at === null) throw new Error(`No "${after}" on the page`);
      editor.commands.setTextSelection(at);
      editor.view.focus();
    },
    { after, selector: ACTIVE_EDITOR },
  );
  await page.keyboard.press("Enter");
  await expect(acceptButton(page)).toHaveCount(1, { timeout: 30_000 });
  await page.keyboard.type(typed, { delay: 40 });
}

/** Watches every frame from here on: how far the page moves, and what shows. */
function watchThePage(page: Page) {
  return page.evaluateHandle((selector) => {
    const top = () =>
      document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
    const start = top();
    const seen = { moved: 0, syncingLine: false };
    const look = () => {
      seen.moved = Math.max(seen.moved, Math.abs(top() - start));
      seen.syncingLine ||= !!document.body.textContent?.includes(
        "still syncing",
      );
      requestAnimationFrame(look);
    };
    look();
    return seen;
  }, ACTIVE_EDITOR);
}

/** Accepts the one suggestion, and returns what the page did until it settled. */
async function acceptAndWatch(page: Page, id: string, typed: string) {
  const watch = await watchThePage(page);
  await acceptButton(page).click();
  await expect
    .poll(async () => (await getDocument(page, id)).content, {
      message: "the saved page",
      timeout: 30_000,
    })
    .toContain(typed);
  await expect(acceptButton(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.locator(`${ACTIVE_EDITOR} [data-suggestion-id]`),
  ).toHaveCount(0, { timeout: 30_000 });
  return watch.jsonValue();
}

test.describe("accepting an edit with a line break", () => {
  for (const { name, after, typed } of EDITS) {
    test(`keeps the page still and says nothing, for ${name}`, async ({
      page,
    }) => {
      const id = await openSuggesting(page, `Accept ${name}`);
      await suggestLine(page, after, typed);

      const seen = await acceptAndWatch(page, id, typed);
      expect(seen.syncingLine).toBe(false);
      expect(seen.moved).toBeLessThan(1);
    });
  }

  test("keeps the page still when accepted after suggesting ends", async ({
    page,
  }) => {
    const { after, typed } = EDITS[0]!;
    const id = await openSuggesting(page, "Accept after suggesting");
    await suggestLine(page, after, typed);
    await page.getByRole("button", { name: "Stop suggesting" }).click();
    await expect(
      page.getByRole("button", { name: "Stop suggesting" }),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(acceptButton(page)).toHaveCount(1, { timeout: 30_000 });

    const seen = await acceptAndWatch(page, id, typed);
    expect(seen.syncingLine).toBe(false);
    expect(seen.moved).toBeLessThan(1);
  });
});
