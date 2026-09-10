import { expect, test, type Page } from "@playwright/test";

/*
 * The account this project signs in with is created fresh per run, so its very
 * first Page load reproduces the reported post-signup arrival: sign-up resumes
 * whatever Page URL the browser was on, and for a brand-new account that URL
 * routinely names a document the account cannot read. Landing on "Document
 * unavailable" there left the user with no valid destination at all.
 */

/** A Page id no account can hold — the shape of the reported resumed link. */
const UNKNOWN_DOCUMENT_ID = "inbox";

/** The opened document id, or `null` while the browser is anywhere else. A
 * non-Page URL is not a recovered Page, so the two stay distinguishable. */
function openedDocumentId(page: Page): string | null {
  const match = /^\/page\/([^/?#]+)/.exec(new URL(page.url()).pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

async function openRecoveredPage(page: Page): Promise<string> {
  await page.goto(`/page/${UNKNOWN_DOCUMENT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => openedDocumentId(page), {
      message: "the unreadable deep link never resolved to a usable Page",
      timeout: 60_000,
    })
    .toMatch(/^(?!inbox$).+/);
  const recovered = openedDocumentId(page);
  if (!recovered) throw new Error("recovery left the browser off a Page route");
  return recovered;
}

test("a first arrival at an unreadable Page lands on a Page the account can open", async ({
  page,
}) => {
  await openRecoveredPage(page);

  await expect(page.getByLabel("Document title")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Document unavailable" }),
  ).toHaveCount(0);
  // The recovery says why rather than silently moving the browser.
  await expect(
    page.getByText("That page is not available to your account", {
      exact: false,
    }),
  ).toBeVisible();
});

test("the recovered Page survives the reload a stuck user would try", async ({
  page,
}) => {
  const recovered = await openRecoveredPage(page);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByLabel("Document title")).toBeVisible();
  expect(openedDocumentId(page)).toBe(recovered);
});
