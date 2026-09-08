import { expect, test, type APIResponse, type Page } from "@playwright/test";

const ACTION_HEADERS = { "X-Agent-Native-Frontend": "1" };

type ActionResult = Record<string, any>;

async function readJson(response: APIResponse): Promise<ActionResult> {
  try {
    return (await response.json()) as ActionResult;
  } catch {
    return {};
  }
}

async function runAction(
  page: Page,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await page.request.post(`/_agent-native/actions/${name}`, {
    data,
    headers: ACTION_HEADERS,
  });
  const result = await readJson(response);
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

async function readAction(
  page: Page,
  name: string,
  params: Record<string, string>,
): Promise<ActionResult> {
  const query = new URLSearchParams(params);
  const response = await page.request.get(
    `/_agent-native/actions/${name}?${query.toString()}`,
    { headers: ACTION_HEADERS },
  );
  const result = await readJson(response);
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

async function createDatabaseFixture(page: Page) {
  const title = `Preview menu E2E ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await runAction(page, "create-content-database", { title });
  const databaseId = created.database?.id as string | undefined;
  const databaseDocumentId = created.database?.documentId as string | undefined;
  expect(
    databaseId,
    "create-content-database returns database.id",
  ).toBeTruthy();
  expect(
    databaseDocumentId,
    "create-content-database returns database.documentId",
  ).toBeTruthy();

  const discovered = await readAction(page, "get-content-database", {
    databaseId: databaseId as string,
  });
  const contract = discovered.mutationContract as
    | {
        target: Record<string, unknown>;
        schemaRevision: string;
      }
    | undefined;
  expect(
    contract,
    "get-content-database returns mutationContract",
  ).toBeTruthy();
  const row = await runAction(page, "add-database-item", {
    target: contract!.target,
    expectedSchemaRevision: contract!.schemaRevision,
    idempotencyKey: `preview-menu-${Date.now()}`,
  });
  const rowDocumentId = row.receipt?.row?.documentId as string | undefined;
  expect(
    rowDocumentId,
    "add-database-item returns receipt.row.documentId",
  ).toBeTruthy();
  await runAction(page, "update-document", {
    id: rowDocumentId,
    content: "Loaded preview body for the overflow menu acceptance test.",
  });

  return {
    databaseId: databaseId as string,
    databaseDocumentId: databaseDocumentId as string,
    rowDocumentId: rowDocumentId as string,
  };
}

async function cleanupDatabaseFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof createDatabaseFixture>>,
) {
  const trashed = await runAction(page, "delete-content-database", {
    databaseId: fixture.databaseId,
  });
  expect(trashed.documentId).toBe(fixture.databaseDocumentId);
  await runAction(page, "permanently-delete-document", {
    id: fixture.databaseDocumentId,
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`database half-page preview menu works with pointer and keyboard in ${theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("theme", selectedTheme);
    }, theme);

    let fixture: Awaited<ReturnType<typeof createDatabaseFixture>> | null =
      null;
    try {
      fixture = await createDatabaseFixture(page);
      await page.goto(`/page/${fixture.databaseDocumentId}`, {
        waitUntil: "domcontentloaded",
      });

      const openPreview = page.getByRole("button", {
        name: "Open Untitled preview",
      });
      await expect(openPreview).toBeVisible();
      await openPreview.click();

      const preview = page.getByRole("dialog", { name: "Untitled" });
      const trigger = page.getByRole("button", {
        name: "Preview actions for Untitled",
      });
      await expect(preview).toBeVisible();
      await expect(
        preview.getByText(
          "Loaded preview body for the overflow menu acceptance test.",
        ),
      ).toBeVisible();
      await expect(trigger).toBeVisible();

      await trigger.click();
      const menu = page.getByRole("menu");
      const duplicateRow = page.getByRole("menuitem", {
        name: "Duplicate row",
      });
      await expect(menu).toBeVisible();
      await expect(duplicateRow).toBeVisible();
      await expect(preview).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(preview).toBeVisible();
      await expect(trigger).toBeFocused();

      await trigger.press("Enter");
      await expect(menu).toBeVisible();
      await expect(duplicateRow).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();

      await trigger.press("Space");
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(preview).toBeVisible();

      const databaseAfterMenu = await readAction(page, "get-content-database", {
        documentId: fixture.databaseDocumentId,
      });
      expect(databaseAfterMenu.items).toHaveLength(1);
      expect(databaseAfterMenu.items[0]?.document?.id).toBe(
        fixture.rowDocumentId,
      );

      await page.locator("main").click({ position: { x: 24, y: 160 } });
      await expect(preview).toBeHidden();

      await openPreview.click();
      await page.getByRole("button", { name: "Open page" }).click();
      await expect(page).toHaveURL(`/page/${fixture.rowDocumentId}`);
      const fullPageMenu = page.getByRole("button", {
        name: "More page actions",
      });
      await expect(fullPageMenu).toBeVisible();
      await fullPageMenu.click();
      await expect(
        page.getByRole("menuitem", { name: "Copy page link" }),
      ).toBeVisible();
    } finally {
      if (fixture) await cleanupDatabaseFixture(page, fixture);
    }
  });
}
