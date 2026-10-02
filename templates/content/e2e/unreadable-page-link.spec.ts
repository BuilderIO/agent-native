import { expect, test, type Page } from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

/**
 * A Page id that doesn't exist, unique per run, so an earlier run or a shared
 * database can't have created it.
 */
function missingDocumentId(): string {
  return `missing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function accessStatus(page: Page, documentId: string) {
  const response = await page.request.get(
    `/_agent-native/actions/get-resource-access-status?resourceType=document&resourceId=${encodeURIComponent(documentId)}`,
    { headers: ACTION_HEADERS },
  );
  expect(response.ok(), "get-resource-access-status should answer").toBe(true);
  return response.json();
}

async function createDocument(page: Page, title: string): Promise<string> {
  const created = await page.request.post(
    "/_agent-native/actions/create-document",
    {
      data: { title, content: "Only the owner can read this." },
      headers: ACTION_HEADERS,
    },
  );
  expect(created.ok(), "create-document should succeed").toBeTruthy();
  return ((await created.json()) as { id: string }).id;
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

async function openMissingPage(page: Page): Promise<string> {
  const requested = missingDocumentId();
  await page.goto(`/page/${requested}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "This page doesn't exist" }),
  ).toBeVisible({ timeout: 60_000 });
  return requested;
}

test("a link to a Page that doesn't exist stays on its URL and says so", async ({
  page,
}) => {
  const requested = await openMissingPage(page);

  expect(openedPath(page)).toBe(`/page/${requested}`);
  expect(await accessStatus(page, requested)).toEqual({ state: "missing" });
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Go to my pages" }),
  ).toBeVisible();
  await expect(page.getByText(/signed in as/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Switch account" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Document title")).toHaveCount(0);
});

test("the state survives the reload a stuck person would try", async ({
  page,
}) => {
  const requested = await openMissingPage(page);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "This page doesn't exist" }),
  ).toBeVisible({ timeout: 60_000 });
  expect(openedPath(page)).toBe(`/page/${requested}`);
});

test("Go to my pages opens a Page the account can open", async ({ page }) => {
  const requested = await openMissingPage(page);

  await page.getByRole("link", { name: "Go to my pages" }).click();

  await expect
    .poll(() => openedPath(page), { timeout: 60_000 })
    .toMatch(/^\/page\/(?!missing-)/);
  expect(openedPath(page)).not.toBe(`/page/${requested}`);
  // The landing may be a Page or a Database View; either way it opens.
  await expect(
    page.getByRole("heading", { name: "This page doesn't exist" }),
  ).toHaveCount(0, { timeout: 60_000 });
});

test("the owner's link to a trashed Page says so and restores it", async ({
  page,
}) => {
  const documentId = await createDocument(
    page,
    `Trashed link E2E ${Date.now().toString(36)}`,
  );

  try {
    const trashed = await page.request.post(
      "/_agent-native/actions/delete-document",
      { data: { id: documentId }, headers: ACTION_HEADERS },
    );
    expect(trashed.ok(), "delete-document should succeed").toBeTruthy();

    await page.goto(`/page/${documentId}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "This page is in the trash" }),
    ).toBeVisible({ timeout: 60_000 });
    expect(await accessStatus(page, documentId)).toEqual({
      state: "trashed",
      role: "owner",
    });
    await expect(page.getByRole("link", { name: "Open Trash" })).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).click();

    await expect(page.getByLabel("Document title")).toBeVisible({
      timeout: 60_000,
    });
    expect(openedPath(page)).toBe(`/page/${documentId}`);
  } finally {
    await removeDocument(page, documentId);
  }
});

test("the owner's private share link opens the Page without the private notice", async ({
  page,
}) => {
  const documentId = await createDocument(
    page,
    `Private share link E2E ${Date.now().toString(36)}`,
  );

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
