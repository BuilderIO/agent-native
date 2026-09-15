import { expect, test, type APIResponse, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

type ActionResult = Record<string, any>;

type PreviewRowFixture = {
  itemId: string;
  documentId: string;
  title: string;
  body: string;
  propertyValue: string;
};

type DatabaseFixture = {
  databaseId: string;
  databaseDocumentId: string;
  propertyId: string;
  rows: PreviewRowFixture[];
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

async function readAction(
  page: Page,
  name: string,
  params: Record<string, string>,
): Promise<ActionResult> {
  const response = await page.request.get(`/_agent-native/actions/${name}`, {
    params,
    headers: ACTION_HEADERS,
  });
  const result = await readJson(response);
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

async function ensureAuthenticatedLocalSession(page: Page) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => {
      const response = await page.request.get("/_agent-native/auth/session");
      if (!response.ok()) return null;
      const session = await readJson(response);
      return typeof session.email === "string" ? session.email : null;
    })
    .not.toBeNull();
}

async function createDatabaseFixture(
  page: Page,
  rowCount = 1,
): Promise<DatabaseFixture> {
  const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const title = `Preview parity E2E ${marker}`;
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

  const propertyName = "Acceptance marker";
  const configured = await runAction(page, "configure-document-property", {
    documentId: databaseDocumentId,
    databaseId,
    name: propertyName,
    type: "text",
  });
  const propertyId = configured.properties?.find(
    (property: ActionResult) => property.definition?.name === propertyName,
  )?.definition?.id as string | undefined;
  expect(
    propertyId,
    "configure-document-property returns the new property",
  ).toBeTruthy();

  const discovered = await readAction(page, "get-content-database", {
    databaseId: databaseId as string,
  });
  const contract = discovered.mutationContract as
    | { target: Record<string, unknown>; schemaRevision: string }
    | undefined;
  expect(
    contract,
    "get-content-database returns mutationContract",
  ).toBeTruthy();

  const rows: PreviewRowFixture[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const letter = String.fromCharCode(65 + index);
    const row = await runAction(page, "add-database-item", {
      target: contract!.target,
      expectedSchemaRevision: contract!.schemaRevision,
      idempotencyKey: `preview-parity-${marker}-${letter}`,
    });
    const itemId = row.receipt?.row?.itemId as string | undefined;
    const documentId = row.receipt?.row?.documentId as string | undefined;
    expect(itemId, "add-database-item returns receipt.row.itemId").toBeTruthy();
    expect(
      documentId,
      "add-database-item returns receipt.row.documentId",
    ).toBeTruthy();

    const rowFixture = {
      itemId: itemId as string,
      documentId: documentId as string,
      title: `Preview row ${letter} ${marker}`,
      body: `Distinct preview body ${letter} ${marker}`,
      propertyValue: `Property ${letter} ${marker}`,
    };
    await runAction(page, "update-document", {
      id: rowFixture.documentId,
      title: rowFixture.title,
      content: rowFixture.body,
    });
    await runAction(page, "set-document-property", {
      documentId: rowFixture.documentId,
      databaseId,
      propertyId,
      value: rowFixture.propertyValue,
    });
    rows.push(rowFixture);
  }

  return {
    databaseId: databaseId as string,
    databaseDocumentId: databaseDocumentId as string,
    propertyId: propertyId as string,
    rows,
  };
}

async function cleanupDatabaseFixture(page: Page, fixture: DatabaseFixture) {
  const trashed = await runAction(page, "delete-content-database", {
    databaseId: fixture.databaseId,
  });
  expect(trashed.documentId).toBe(fixture.databaseDocumentId);
  await runAction(page, "permanently-delete-document", {
    id: fixture.databaseDocumentId,
  });
}

function previewDialog(page: Page) {
  return page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Open page" }),
  });
}

async function openPreview(page: Page, title: string) {
  await page.getByRole("button", { name: `Open ${title} preview` }).click();
  const preview = previewDialog(page);
  await expect(preview).toBeVisible();
  await expect(preview.getByLabel("Document title")).toHaveValue(title);
  return preview;
}

async function expectCanonicalPageControls(
  preview: ReturnType<typeof previewDialog>,
) {
  await expect(
    preview.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Comments", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "More page actions" }),
  ).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`database Page preview exposes canonical and row actions in ${theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("theme", selectedTheme);
    }, theme);

    let fixture: DatabaseFixture | null = null;
    try {
      await ensureAuthenticatedLocalSession(page);
      fixture = await createDatabaseFixture(page);
      const row = fixture.rows[0]!;
      await page.goto(`/page/${fixture.databaseDocumentId}`, {
        waitUntil: "domcontentloaded",
      });

      const preview = await openPreview(page, row.title);
      await expect(preview.locator(".ProseMirror")).toContainText(row.body);
      await expectCanonicalPageControls(preview);

      const rowActions = preview.getByRole("button", {
        name: `Preview actions for ${row.title}`,
      });
      await rowActions.click();
      const rowMenu = page.getByRole("menu").filter({
        has: page.getByRole("menuitem", { name: "Duplicate row" }),
      });
      await expect(rowMenu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(rowActions).toBeFocused();
      await expect(preview).toBeVisible();

      await rowActions.press("Enter");
      await expect(
        rowMenu.getByRole("menuitem", { name: "Duplicate row" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(rowActions).toBeFocused();

      const pageActions = preview.getByRole("button", {
        name: "More page actions",
      });
      await pageActions.click();
      const pageMenu = page.getByRole("menu").filter({
        has: page.getByRole("menuitem", { name: "Copy page link" }),
      });
      for (const name of [
        "Copy page link",
        "Info",
        "Version history",
        "Export",
        "Delete",
      ]) {
        await expect(
          pageMenu.getByRole("menuitem", { name, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(pageActions).toBeFocused();

      const databaseAfterMenus = await readAction(
        page,
        "get-content-database",
        { documentId: fixture.databaseDocumentId },
      );
      expect(databaseAfterMenus.items).toHaveLength(1);
      expect(databaseAfterMenus.items[0]?.document?.id).toBe(row.documentId);
    } finally {
      if (fixture) await cleanupDatabaseFixture(page, fixture);
    }
  });
}

test("database Page preview preserves controls, row identity, and dirty handoff", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    let preview = await openPreview(page, rowA.title);
    const actionFreshTitle = `${rowA.title} action fresh`;
    await runAction(page, "update-document", {
      id: rowA.documentId,
      title: actionFreshTitle,
    });
    await expect(preview.getByLabel("Document title")).toHaveValue(
      actionFreshTitle,
    );
    rowA.title = actionFreshTitle;

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(preview).toBeVisible();
      await expect(
        preview.getByRole("button", { name: "Open page" }),
      ).toBeVisible();
      await expect(
        preview.getByRole("button", { name: "Previous database page" }),
      ).toBeDisabled();
      await expect(
        preview.getByRole("button", { name: "Next database page" }),
      ).toBeEnabled();
      await expectCanonicalPageControls(preview);
      if (viewport.width === 390) {
        await expect
          .poll(() =>
            preview
              .getByLabel("Document title")
              .evaluate(
                (element) => element.scrollHeight <= element.clientHeight,
              ),
          )
          .toBe(true);
      }
      await testInfo.attach(`preview-${viewport.width}px`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }

    const pageActions = preview.getByRole("button", {
      name: "More page actions",
    });
    await pageActions.click();
    await page.getByRole("menuitem", { name: "Info", exact: true }).click();
    const infoDialog = page.getByRole("dialog", { name: "Info" });
    const info = infoDialog.locator("[data-document-info-panel]");
    await expect(info).toBeVisible();
    await expect(info.getByLabel("Description")).toBeVisible();
    await expect(
      info.getByText("Acceptance marker", { exact: true }),
    ).toBeVisible();
    await expect(
      info.getByText(rowA.propertyValue, { exact: true }),
    ).toBeVisible();
    const propertyAccess = await readAction(page, "list-document-properties", {
      documentId: rowA.documentId,
      databaseId: fixture.databaseId,
    });
    expect(propertyAccess).toMatchObject({
      canEditValues: true,
      canManageSchema: true,
    });
    await expect(
      info.getByRole("button", { name: "Edit Acceptance marker" }),
    ).toBeVisible();

    const description = info.getByLabel("Description");
    const descriptionMarker = `Description ${Date.now()}`;
    await description.fill(descriptionMarker);
    await description.press("Enter");
    await expect(description).toHaveValue(descriptionMarker);
    await infoDialog.getByRole("button", { name: "Close panel" }).click();
    await expect(infoDialog).toBeHidden();

    await preview
      .getByRole("button", { name: "Comments", exact: true })
      .click();
    const commentsDialog = page.getByRole("dialog", { name: "Comments" });
    await expect(commentsDialog).toBeVisible();
    await expect(
      commentsDialog.getByText("No matching comments.", { exact: true }),
    ).toBeVisible();
    const actionComment = `Action comment ${Date.now()}`;
    await runAction(page, "add-comment", {
      documentId: rowA.documentId,
      content: actionComment,
      quotedText: rowA.body,
    });
    await expect(
      commentsDialog.getByText(actionComment, { exact: true }),
    ).toBeVisible();
    await commentsDialog.getByRole("button", { name: "Close panel" }).click();
    await expect(commentsDialog).toBeHidden();

    const dirtyTitle = `${rowA.title} dirty handoff`;
    const dirtyBody = `${rowA.body}\n\nImmediate preview edit`;
    await preview.getByLabel("Document title").fill(dirtyTitle);
    await preview.locator(".ProseMirror").fill(dirtyBody);
    await preview.getByRole("button", { name: "Next database page" }).click();

    preview = previewDialog(page);
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowB.body);
    await expect(preview.locator(".ProseMirror")).not.toContainText(
      "Immediate preview edit",
    );
    await expect(
      preview.getByRole("button", { name: "Next database page" }),
    ).toBeDisabled();
    await preview
      .getByRole("button", { name: "Previous database page" })
      .click();
    await expect(preview.getByLabel("Document title")).toHaveValue(dirtyTitle);
    await expect(preview.locator(".ProseMirror")).toContainText(
      "Immediate preview edit",
    );
    await expect(preview.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );

    const dirtyCloseMarker = `Dirty close ${Date.now()}`;
    const rowATrigger = page.getByRole("button", {
      name: `Open ${dirtyTitle} preview`,
    });
    await preview
      .locator(".ProseMirror")
      .fill(`${dirtyBody}\n\n${dirtyCloseMarker}`);
    await preview.getByRole("button", { name: "Close", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(rowATrigger).toBeFocused();
    await expect
      .poll(async () => {
        const persisted = await readAction(page, "get-document", {
          id: rowA.documentId,
          databaseId: fixture!.databaseId,
          databaseDocumentId: fixture!.databaseDocumentId,
        });
        return String(persisted.content).includes(dirtyCloseMarker);
      })
      .toBe(true);
    preview = await openPreview(page, dirtyTitle);
    await expect(preview.locator(".ProseMirror")).toContainText(
      dirtyCloseMarker,
    );

    const fullPageTitle = `${dirtyTitle} open page`;
    await preview.getByLabel("Document title").fill(fullPageTitle);
    await preview
      .getByRole("button", { name: "Open page", exact: true })
      .click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === `/page/${rowA.documentId}` &&
        url.searchParams.get("databaseId") === fixture!.databaseId &&
        url.searchParams.get("databaseDocumentId") ===
          fixture!.databaseDocumentId
      );
    });
    await expect(page.getByLabel("Document title")).toHaveValue(fullPageTitle);
    await expect(page.locator(".ProseMirror")).toContainText(dirtyCloseMarker);

    await expect
      .poll(async () => {
        const persisted = await readAction(page, "get-document", {
          id: rowA.documentId,
          databaseId: fixture!.databaseId,
          databaseDocumentId: fixture!.databaseDocumentId,
        });
        return {
          title: persisted.title,
          description: persisted.description,
          hasBody: String(persisted.content).includes(dirtyCloseMarker),
        };
      })
      .toEqual({
        title: fullPageTitle,
        description: descriptionMarker,
        hasBody: true,
      });

    const properties = await readAction(page, "list-document-properties", {
      documentId: rowA.documentId,
      databaseId: fixture.databaseId,
    });
    const acceptanceProperty = properties.properties?.find(
      (property: ActionResult) =>
        property.definition?.id === fixture!.propertyId,
    );
    expect(acceptanceProperty?.value).toBe(rowA.propertyValue);
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("database Page preview reflects mocked Page role capabilities and unavailable reads", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  const getDocumentPattern = "**/_agent-native/actions/get-document**";
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page);
    const row = fixture.rows[0]!;
    const databasePageUrl = `/page/${fixture.databaseDocumentId}`;

    // Authentication, fixture ownership, and this baseline read are real local
    // server evidence. The role projections below mock only get-document so the
    // shared Page host can be checked deterministically for every capability.
    const ownedDocument = await readAction(page, "get-document", {
      id: row.documentId,
      databaseId: fixture.databaseId,
      databaseDocumentId: fixture.databaseDocumentId,
    });
    expect(ownedDocument).toMatchObject({
      id: row.documentId,
      canComment: true,
      canEdit: true,
      canManage: true,
    });

    const roleCases = [
      {
        accessRole: "viewer",
        canComment: false,
        canEdit: false,
        canManage: false,
      },
      {
        accessRole: "commenter",
        canComment: true,
        canEdit: false,
        canManage: false,
      },
      {
        accessRole: "editor",
        canComment: true,
        canEdit: true,
        canManage: false,
      },
      {
        accessRole: "admin",
        canComment: true,
        canEdit: true,
        canManage: true,
      },
    ] as const;

    for (const role of roleCases) {
      let mockedReads = 0;
      await page.route(getDocumentPattern, async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("id") !== row.documentId) {
          await route.fallback();
          return;
        }
        mockedReads += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...ownedDocument, ...role }),
        });
      });

      await page.goto(databasePageUrl, { waitUntil: "domcontentloaded" });
      const preview = await openPreview(page, row.title);
      await expect.poll(() => mockedReads).toBeGreaterThan(0);
      const title = preview.getByLabel("Document title");
      if (role.canEdit) {
        await expect(title).not.toHaveAttribute("readonly", "");
      } else {
        await expect(title).toHaveAttribute("readonly", "");
      }
      await expect(preview.locator(".ProseMirror")).toHaveAttribute(
        "contenteditable",
        String(role.canEdit),
      );

      const comments = preview.getByRole("button", {
        name: "Comments",
        exact: true,
      });
      if (role.canComment) {
        await expect(comments).toBeVisible();
      } else {
        await expect(comments).toHaveCount(0);
      }

      const pageActions = preview.getByRole("button", {
        name: "More page actions",
      });
      await pageActions.click();
      const pageMenu = page.getByRole("menu").filter({
        has: page.getByRole("menuitem", { name: "Copy page link" }),
      });
      const deleteAction = pageMenu.getByRole("menuitem", {
        name: "Delete",
        exact: true,
      });
      if (role.canManage) {
        await expect(deleteAction).toBeVisible();
      } else {
        await expect(deleteAction).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      await page.unroute(getDocumentPattern);
    }

    let unavailableReads = 0;
    await page.route(getDocumentPattern, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("id") !== row.documentId) {
        await route.fallback();
        return;
      }
      unavailableReads += 1;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected missing document" }),
      });
    });
    await page.goto(databasePageUrl, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: `Open ${row.title} preview` })
      .click();
    const preview = previewDialog(page);
    await expect(preview).toBeVisible();
    await expect.poll(() => unavailableReads).toBeGreaterThan(0);
    await expect(
      preview.getByRole("heading", { name: "Document unavailable" }),
    ).toBeVisible();
    await expect(preview.getByLabel("Document title")).toHaveCount(0);
    await page.unroute(getDocumentPattern);
  } finally {
    await page.unroute(getDocumentPattern);
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a failed preview metadata save keeps the Page editor and draft mounted", async ({
  page,
}) => {
  let fixture: DatabaseFixture | null = null;
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page);
    const row = fixture.rows[0]!;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, row.title);
    let failedRequests = 0;
    await page.route(
      "**/_agent-native/actions/update-document**",
      async (route) => {
        failedRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected preview save failure" }),
        });
      },
    );

    const retainedTitle = `${row.title} retained after failure`;
    const title = preview.getByLabel("Document title");
    await title.fill(retainedTitle);
    await title.blur();
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    await expect(preview).toBeVisible();
    await expect(title).toHaveValue(retainedTitle);
    await expect(preview.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );

    await page.unroute("**/_agent-native/actions/update-document**");
    const recoveredTitle = `${retainedTitle} recovered`;
    await title.fill(recoveredTitle);
    await title.blur();
    await expect
      .poll(async () => {
        const persisted = await readAction(page, "get-document", {
          id: row.documentId,
          databaseId: fixture!.databaseId,
          databaseDocumentId: fixture!.databaseDocumentId,
        });
        return persisted.title;
      })
      .toBe(recoveredTitle);
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});
