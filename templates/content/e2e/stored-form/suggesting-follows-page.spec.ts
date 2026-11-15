import { expect, test, type Page } from "@playwright/test";

import {
  ACTION_HEADERS,
  ACTIVE_EDITOR,
  createPage,
  expectEditorReady,
  getDocument,
  gotoEditor,
  typeAtParagraphEnd,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

// A tab in Suggesting mode works on a draft of the Page as it was when the
// tab started suggesting, and the server takes a suggestion only against the
// Page as it stands. When someone else changed the Page, the suggesting tab
// never showed it, and its next suggestion failed with "Could not create
// suggestion". The draft now moves to the newer Page once everything typed in
// it is saved and the typing has paused, keeping the caret where it was.

test.describe.configure({ retries: 0, timeout: 120_000 });

const BODY = [
  "Opening paragraph of the page.",
  "",
  "Middle paragraph of the page.",
  "",
  "Closing paragraph of the page.",
].join("\n");

/** The editor's paragraphs, as the person sees them. */
function paragraphs(page: Page) {
  return page.locator(`${ACTIVE_EDITOR} > p`);
}

async function startSuggesting(page: Page) {
  await page.getByRole("button", { name: "More page actions" }).click();
  await page.getByRole("menuitem", { name: "Suggest edits" }).click();
  await expect(
    page.getByRole("button", { name: "Stop suggesting" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function pendingSuggestions(page: Page, id: string) {
  const response = await page.request.get(
    "/_agent-native/actions/list-resource-suggestions",
    {
      params: { resourceType: "document", resourceId: id },
      headers: ACTION_HEADERS,
    },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `list-resource-suggestions (${response.status()}): ${text}`,
  ).toBe(true);
  return (
    JSON.parse(text) as {
      suggestions: Array<{
        status: string;
        baseRevision: string;
        operations: unknown;
      }>;
    }
  ).suggestions.filter((suggestion) => suggestion.status === "pending");
}

/** Opens the same new Page in two tabs, the first one suggesting. */
async function openSuggesterAndWriter(page: Page, title: string) {
  const id = await createPage(page, title, BODY);
  await enterGateArm(page, id);
  await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
  await startSuggesting(page);
  const writer = await page.context().newPage();
  await gotoEditor(writer, id);
  return { id, suggester: page, writer };
}

/** The writer's words reach the saved Page, and then the suggesting tab. */
async function writeInOtherTab(
  writer: Page,
  suggester: Page,
  id: string,
  anchor: string,
  words: string,
) {
  await typeAtParagraphEnd(writer, anchor, words);
  await expect
    .poll(async () => (await getDocument(writer, id)).content, {
      message: "the saved Page",
      timeout: 30_000,
    })
    .toContain(words.trim());
  await expect(
    paragraphs(suggester).filter({ hasText: anchor }),
    "the suggesting tab shows the other tab's words",
  ).toContainText(words.trim(), { timeout: 30_000 });
}

const failedAlert = (page: Page) =>
  page.getByText(/could not create suggestion/i);

test.describe("a suggesting tab and another tab's change", () => {
  test("shows the change, and its next suggestion saves", async ({ page }) => {
    const { id, suggester, writer } = await openSuggesterAndWriter(
      page,
      "Suggesting follows the Page",
    );

    await writeInOtherTab(
      writer,
      suggester,
      id,
      "Middle paragraph",
      " Words from another tab.",
    );

    await typeAtParagraphEnd(suggester, "Opening paragraph", " Suggested.");
    const revision = (await getDocument(suggester, id)).revision;
    await expect
      .poll(async () => await pendingSuggestions(suggester, id), {
        message: "the saved suggestion",
        timeout: 30_000,
      })
      .toEqual([expect.objectContaining({ baseRevision: revision })]);
    await expect(failedAlert(suggester)).toHaveCount(0);
    expect((await getDocument(suggester, id)).content).not.toContain(
      "Suggested.",
    );
    await expect(
      paragraphs(suggester).filter({ hasText: "Middle paragraph" }),
    ).toContainText("Words from another tab.");
  });

  test("keeps the caret where it was", async ({ page }) => {
    const { id, suggester, writer } = await openSuggesterAndWriter(
      page,
      "Suggesting keeps the caret",
    );

    // A saved suggestion before the caret leaves the draft for a mark when
    // the draft moves, which used to send the caret to the other tab's edit.
    await typeAtParagraphEnd(suggester, "Opening paragraph", " First.");
    await expect
      .poll(async () => (await pendingSuggestions(suggester, id)).length, {
        timeout: 30_000,
      })
      .toBe(1);

    await writeInOtherTab(
      writer,
      suggester,
      id,
      "Closing paragraph",
      " Words from another tab.",
    );

    await suggester.bringToFront();
    await suggester.keyboard.type(" Second.", { delay: 40 });
    const revision = (await getDocument(suggester, id)).revision;
    await expect
      .poll(
        async () =>
          (await pendingSuggestions(suggester, id)).some(
            (suggestion) =>
              suggestion.baseRevision === revision &&
              JSON.stringify(suggestion.operations).includes("Second."),
          ),
        { message: "the second suggestion, saved", timeout: 30_000 },
      )
      .toBe(true);
    await expect(failedAlert(suggester)).toHaveCount(0);
    await expect(
      paragraphs(suggester).filter({ hasText: "Opening paragraph" }),
    ).toContainText("Second.");
    await expect(
      paragraphs(suggester).filter({ hasText: "Closing paragraph" }),
    ).not.toContainText("Second.");
  });
});
