import { expect, test, type Page } from "@playwright/test";


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

function openedDocumentId(page: Page): string | null {
  const match = /^\/page\/([^/?#]+)/.exec(new URL(page.url()).pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

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
