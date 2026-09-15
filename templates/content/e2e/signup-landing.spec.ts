import { expect, test, type Page } from "@playwright/test";

/*
 * The account this project signs in with is created fresh per run, so its very
 * first Page load reproduces the reported post-signup arrival: sign-up resumes
 * whatever Page URL the browser was on, and for a brand-new account that URL
 * routinely names a document the account cannot read. Landing on "Document
 * unavailable" there left the user with no valid destination at all.
 */

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

/**
 * A Page id this account cannot read, unique per run. The reported link was
 * `/page/inbox`, but the invariant under test is the unreadable id rather than
 * that exact string — and a fixed id can be made readable by an earlier run, an
 * agent, or a shared database, which would fail these tests for a cause they do
 * not name.
 */
function unreadableDocumentId(): string {
  return `missing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Establish the premise before asserting recovery, so a readable id fails here
 * with its own message instead of timing out inside the recovery poll. */
async function assertUnreadable(page: Page, documentId: string): Promise<void> {
  const response = await page.request.get(
    `/_agent-native/actions/get-document?id=${encodeURIComponent(documentId)}`,
    { headers: ACTION_HEADERS },
  );
  expect(
    [403, 404],
    `get-document answered ${response.status()} for ${documentId}; these tests need an unreadable page (403/404) to exercise the recovery path`,
  ).toContain(response.status());
}

/** The opened document id, or `null` while the browser is anywhere else. A
 * non-Page URL is not a recovered Page, so the two stay distinguishable. */
function openedDocumentId(page: Page): string | null {
  const match = /^\/page\/([^/?#]+)/.exec(new URL(page.url()).pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The settled destination, or `null`. Recovery passes through the landing
 * route, which is neither the requested Page nor a recovered one, so "left the
 * bad URL" is not yet "arrived somewhere usable". */
function recoveredDocumentId(page: Page, requested: string): string | null {
  const opened = openedDocumentId(page);
  return opened && opened !== requested ? opened : null;
}

async function openRecoveredPage(page: Page): Promise<string> {
  const requested = unreadableDocumentId();
  await page.goto(`/page/${requested}`, { waitUntil: "domcontentloaded" });
  await assertUnreadable(page, requested);

  await expect
    .poll(() => recoveredDocumentId(page, requested), {
      message: "the unreadable deep link never resolved to a usable Page",
      timeout: 60_000,
    })
    .not.toBeNull();
  const recovered = recoveredDocumentId(page, requested);
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
