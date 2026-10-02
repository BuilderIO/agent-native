import { expect, test, type Page } from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

/**
 * A Page id this account cannot read, unique per run. A private Page that
 * isn't shared with the account answers the same 404 as a missing one, so a
 * fresh id exercises the state a person sees after following a private link,
 * and a fixed id could be made readable by an earlier run or a shared database.
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
    `get-document answered ${response.status()} for ${documentId}; these tests need an unreadable page (403/404)`,
  ).toContain(response.status());
}

async function removeDocument(page: Page, id: string): Promise<void> {
  await page.request.post("/_agent-native/actions/delete-document", {
    data: { id },
    headers: ACTION_HEADERS,
  });
  const plan = await page.request.post(
    "/_agent-native/actions/plan-content-trash-purge",
    { data: { mode: "selection", documentIds: [id] }, headers: ACTION_HEADERS },
  );
  if (!plan.ok()) return;
  const { planId, scopeToken } = (await plan.json()) as {
    planId: string;
    scopeToken: string;
  };
  await page.request.post(
    "/_agent-native/actions/permanently-delete-document",
    { data: { id, planId, scopeToken }, headers: ACTION_HEADERS },
  );
}

function openedPath(page: Page): string {
  return new URL(page.url()).pathname;
}

async function openUnreadablePage(page: Page): Promise<string> {
  const requested = unreadableDocumentId();
  await page.goto(`/page/${requested}`, { waitUntil: "domcontentloaded" });
  await assertUnreadable(page, requested);
  await expect(
    page.getByRole("heading", { name: "Document unavailable" }),
  ).toBeVisible({ timeout: 60_000 });
  return requested;
}

test("an unreadable Page link stays on its URL and says which account can't open it", async ({
  page,
}) => {
  const requested = await openUnreadablePage(page);

  expect(openedPath(page)).toBe(`/page/${requested}`);
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to my pages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch account" }),
  ).toBeVisible();
  await expect(page.getByLabel("Document title")).toHaveCount(0);
});

test("the no-access state survives the reload a stuck person would try", async ({
  page,
}) => {
  const requested = await openUnreadablePage(page);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Document unavailable" }),
  ).toBeVisible({ timeout: 60_000 });
  expect(openedPath(page)).toBe(`/page/${requested}`);
});

test("Go to my pages opens a Page the account can open", async ({ page }) => {
  const requested = await openUnreadablePage(page);

  await page.getByRole("link", { name: "Go to my pages" }).click();

  await expect
    .poll(() => openedPath(page), { timeout: 60_000 })
    .toMatch(/^\/page\/(?!missing-)/);
  expect(openedPath(page)).not.toBe(`/page/${requested}`);
  // The landing may be a Page or a Database View; either way it opens.
  await expect(
    page.getByRole("heading", { name: "Document unavailable" }),
  ).toHaveCount(0, { timeout: 60_000 });
});

test("the owner's private share link opens the Page without the private notice", async ({
  page,
}) => {
  const created = await page.request.post(
    "/_agent-native/actions/create-document",
    {
      data: {
        title: `Private share link E2E ${Date.now().toString(36)}`,
        content: "Only the owner can read this.",
      },
      headers: ACTION_HEADERS,
    },
  );
  expect(created.ok(), "create-document should succeed").toBeTruthy();
  const documentId = ((await created.json()) as { id: string }).id;

  try {
    // Every share page is the same cached private notice, so the owner's
    // browser must leave it before painting it.
    let noticeFrames = 0;
    await page.exposeFunction("__privateNoticePainted", () => {
      noticeFrames += 1;
    });
    await page.addInitScript(() => {
      const tick = () => {
        for (const heading of document.querySelectorAll("h1")) {
          if (
            heading.textContent?.includes("This document is private") &&
            heading.checkVisibility({ visibilityProperty: true })
          ) {
            (
              window as Window & { __privateNoticePainted?: () => void }
            ).__privateNoticePainted?.();
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(`/p/${documentId}`, { waitUntil: "commit" });

    await expect
      .poll(() => openedPath(page), { timeout: 60_000 })
      .toBe(`/page/${documentId}`);
    await expect(page.getByLabel("Document title")).toBeVisible({
      timeout: 60_000,
    });
    expect(noticeFrames).toBe(0);
  } finally {
    await removeDocument(page, documentId);
  }
});
