import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};
const FIXTURE_PREFIX = "Sidebar delete owner E2E";

type ActionResult = Record<string, any>;

type Fixture = {
  documentId: string;
  databaseId?: string;
  title: string;
};

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

async function readAction(page: Page, name: string): Promise<ActionResult> {
  const response = await page.request.get(`/_agent-native/actions/${name}`, {
    headers: ACTION_HEADERS,
  });
  const result = await readJson(response);
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

function uniqueTitle(label: string): string {
  return `${FIXTURE_PREFIX} ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function createPageFixture(
  page: Page,
  fixtures: Fixture[],
  label: string,
  parentId?: string,
): Promise<Fixture> {
  const title = uniqueTitle(label);
  const created = await runAction(page, "create-document", {
    title,
    content: `Task-owned fixture for ${title}.`,
    parentId,
  });
  expect(created.id, "create-document returns id").toEqual(expect.any(String));
  const fixture = { documentId: created.id as string, title };
  fixtures.push(fixture);
  return fixture;
}

async function createDatabaseFixture(
  page: Page,
  fixtures: Fixture[],
  label: string,
): Promise<Fixture> {
  const title = uniqueTitle(label);
  const created = await runAction(page, "create-content-database", { title });
  expect(
    created.database?.id,
    "create-content-database returns database.id",
  ).toEqual(expect.any(String));
  expect(
    created.database?.documentId,
    "create-content-database returns database.documentId",
  ).toEqual(expect.any(String));
  const fixture = {
    databaseId: created.database.id as string,
    documentId: created.database.documentId as string,
    title,
  };
  fixtures.push(fixture);
  return fixture;
}

async function activeDocumentIds(page: Page): Promise<Set<string>> {
  const listed = await readAction(page, "list-documents");
  const documents = Array.isArray(listed.documents)
    ? listed.documents
    : Array.isArray(listed)
      ? listed
      : [];
  return new Set(
    documents
      .map((document: { id?: unknown }) => document.id)
      .filter((id: unknown): id is string => typeof id === "string"),
  );
}

async function cleanupFixtures(page: Page, fixtures: Fixture[]) {
  for (const fixture of [...fixtures].reverse()) {
    const activeIds = await activeDocumentIds(page);
    if (activeIds.has(fixture.documentId)) {
      if (fixture.databaseId) {
        await runAction(page, "delete-content-database", {
          databaseId: fixture.databaseId,
        });
      } else {
        await runAction(page, "delete-document", { id: fixture.documentId });
      }
    }

    const permanentlyDeleted = await page.request.post(
      "/_agent-native/actions/permanently-delete-document",
      {
        data: { id: fixture.documentId },
        headers: ACTION_HEADERS,
      },
    );
    if (!permanentlyDeleted.ok()) {
      const [active, trashedPages, trashedDatabases] = await Promise.all([
        activeDocumentIds(page),
        readAction(page, "list-trashed-documents"),
        readAction(page, "list-trashed-content-databases"),
      ]);
      const stillExists =
        active.has(fixture.documentId) ||
        (trashedPages.documents ?? []).some(
          (item: { documentId?: string }) =>
            item.documentId === fixture.documentId,
        ) ||
        (trashedDatabases.databases ?? []).some(
          (item: { documentId?: string }) =>
            item.documentId === fixture.documentId,
        );
      expect(
        stillExists,
        `cleanup should remove ${fixture.title}: ${permanentlyDeleted.status()} ${JSON.stringify(await readJson(permanentlyDeleted)).slice(0, 500)}`,
      ).toBeFalsy();
    }
  }

  const [active, trashedPages, trashedDatabases] = await Promise.all([
    activeDocumentIds(page),
    readAction(page, "list-trashed-documents"),
    readAction(page, "list-trashed-content-databases"),
  ]);
  for (const fixture of fixtures) {
    expect(
      active.has(fixture.documentId),
      `${fixture.title} is not active`,
    ).toBe(false);
    expect(
      (trashedPages.documents ?? []).some(
        (item: { documentId?: string }) =>
          item.documentId === fixture.documentId,
      ),
      `${fixture.title} is not in page Trash`,
    ).toBe(false);
    expect(
      (trashedDatabases.databases ?? []).some(
        (item: { documentId?: string }) =>
          item.documentId === fixture.documentId,
      ),
      `${fixture.title} is not in database Trash`,
    ).toBe(false);
  }
}

async function sidebarItem(page: Page, title: string): Promise<Locator> {
  const link = page.getByRole("link", { name: title, exact: true }).first();
  if (await link.isVisible().catch(() => false)) return link;

  const labelledItem = page.getByLabel(title, { exact: true }).first();
  await expect(labelledItem).toBeVisible();
  return labelledItem;
}

async function deleteActiveSidebarItem(
  page: Page,
  fixture: Fixture,
  ancestorTitles: string[] = [],
) {
  await page.goto(`/page/${fixture.documentId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(new RegExp(`/page/${fixture.documentId}$`));

  for (const ancestorTitle of ancestorTitles) {
    const ancestorItem = await sidebarItem(page, ancestorTitle);
    await ancestorItem.hover();
    const expand = page.getByRole("button", {
      name: new RegExp(`^Expand (?:sidebar )?${ancestorTitle}$`),
    });
    if ((await expand.count()) > 0) {
      await expand.evaluate((element) => {
        (element as HTMLButtonElement).click();
      });
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^Collapse (?:sidebar )?${ancestorTitle}$`),
        }),
      ).toBeAttached();
    }
  }

  const item = await sidebarItem(page, fixture.title);
  await item.hover();
  const moreActions = page.getByRole("button", {
    name: `More actions for ${fixture.title}`,
    exact: true,
  });
  await moreActions.focus();
  await moreActions.press("Enter");
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Move page to Trash?");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await activeDocumentIds(page)).has(fixture.documentId))
    .toBe(false);
}

async function expectPointerInteractionRestored(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        computed: window.getComputedStyle(document.body).pointerEvents,
        inline: document.body.style.pointerEvents,
      })),
    )
    .toEqual({ computed: "auto", inline: "" });
}

async function realClickDifferentSurvivor(
  page: Page,
  survivors: [Fixture, Fixture],
) {
  const survivor =
    survivors.find(
      (fixture) =>
        !new URL(page.url()).pathname.endsWith(`/page/${fixture.documentId}`),
    ) ?? survivors[0];
  const item = await sidebarItem(page, survivor.title);
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/page/${survivor.documentId}$`));
}

test("deleting an active ordinary page restores real sidebar pointer navigation", async ({
  page,
}) => {
  const fixtures: Fixture[] = [];
  try {
    const survivors: [Fixture, Fixture] = [
      await createPageFixture(page, fixtures, "ordinary survivor A"),
      await createPageFixture(page, fixtures, "ordinary survivor B"),
    ];
    const deleted = await createPageFixture(
      page,
      fixtures,
      "active ordinary page",
    );

    await deleteActiveSidebarItem(page, deleted);
    await expectPointerInteractionRestored(page);
    await realClickDifferentSurvivor(page, survivors);
  } finally {
    await cleanupFixtures(page, fixtures);
  }
});

test("deleting an active database page restores real sidebar pointer navigation", async ({
  page,
}) => {
  const fixtures: Fixture[] = [];
  try {
    const survivors: [Fixture, Fixture] = [
      await createPageFixture(page, fixtures, "database survivor A"),
      await createPageFixture(page, fixtures, "database survivor B"),
    ];
    const deleted = await createDatabaseFixture(
      page,
      fixtures,
      "active database page",
    );

    await deleteActiveSidebarItem(page, deleted);
    await expectPointerInteractionRestored(page);
    await realClickDifferentSurvivor(page, survivors);
  } finally {
    await cleanupFixtures(page, fixtures);
  }
});

test("deleting an active nested page subtree restores real sidebar pointer navigation", async ({
  page,
}) => {
  const fixtures: Fixture[] = [];
  try {
    const survivor = await createPageFixture(page, fixtures, "nested survivor");
    const parent = await createPageFixture(page, fixtures, "nested parent");
    const deleted = await createPageFixture(
      page,
      fixtures,
      "active nested folder",
      parent.documentId,
    );
    await createPageFixture(
      page,
      fixtures,
      "nested folder child",
      deleted.documentId,
    );

    await deleteActiveSidebarItem(page, deleted, [parent.title]);
    await expectPointerInteractionRestored(page);
    const survivorItem = await sidebarItem(page, survivor.title);
    await survivorItem.click();
    await expect(page).toHaveURL(new RegExp(`/page/${survivor.documentId}$`));
  } finally {
    await cleanupFixtures(page, fixtures);
  }
});
