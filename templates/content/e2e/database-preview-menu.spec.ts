import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { postAction, presentUiCapability } from "./helpers";

test.describe.configure({ mode: "serial" });

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-video-block-ids-v1",
  "X-Agent-Native-Build-Id": "development",
};

// A page's open reads through get-page-open-read and a later refetch through
// get-document, so a test holding a panel's page read holds both.
const PAGE_READ_PATTERN =
  "**/_agent-native/actions/{get-page-open-read,get-document}**";

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
    // Destructive actions such as the fixture cleanup need same-origin proof.
    headers: { ...ACTION_HEADERS, Origin: new URL(page.url()).origin },
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
    const rowTitle = `Preview row ${letter} ${marker}`;
    const row = await runAction(page, "add-database-item", {
      target: contract!.target,
      expectedSchemaRevision: contract!.schemaRevision,
      idempotencyKey: `preview-parity-${marker}-${letter}`,
      title: rowTitle,
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
      title: rowTitle,
      body: `Distinct preview body ${letter} ${marker}`,
      propertyValue: `Property ${letter} ${marker}`,
    };
    // Marked as the editor's, a body write without the editor's session answers
    // 200 and is held back, so this one isn't marked and is read back.
    const bodyWrite = await page.request.post(
      "/_agent-native/actions/update-document",
      { data: { id: rowFixture.documentId, content: rowFixture.body } },
    );
    expect(bodyWrite.ok(), await bodyWrite.text()).toBeTruthy();
    const written = await readAction(page, "get-document", {
      id: rowFixture.documentId,
    });
    expect(written.content).toContain(rowFixture.body);
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
  const plan = await runAction(page, "plan-content-trash-purge", {
    mode: "selection",
    documentIds: [fixture.databaseDocumentId],
  });
  await presentUiCapability(page);
  await postAction(page, "permanently-delete-document", {
    id: fixture.databaseDocumentId,
    planId: plan.planId,
    scopeToken: plan.scopeToken,
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
    preview.getByRole("button", { name: "Discussion", exact: true }),
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
        has: page.getByRole("menuitem", { name: "Version history" }),
      });
      for (const name of ["Info", "Version history", "Export", "Delete"]) {
        await expect(
          pageMenu.getByRole("menuitem", { name, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(pageMenu).toBeHidden();

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
        preview.getByRole("button", { name: "Previous collection page" }),
      ).toBeDisabled();
      await expect(
        preview.getByRole("button", { name: "Next collection page" }),
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
    const infoDialog = page.getByRole("complementary", { name: "Info" });
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
      .getByRole("button", { name: "Discussion", exact: true })
      .click();
    const commentsDialog = page.getByRole("complementary", {
      name: "Discussion",
    });
    await expect(commentsDialog).toBeVisible();
    await expect(commentsDialog.getByText(/^No comments yet/)).toBeVisible();
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
    await preview.getByRole("button", { name: "Next collection page" }).click();

    preview = previewDialog(page);
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowB.body);
    await expect(preview.locator(".ProseMirror")).not.toContainText(
      "Immediate preview edit",
    );
    await expect(
      preview.getByRole("button", { name: "Next collection page" }),
    ).toBeDisabled();
    await preview
      .getByRole("button", { name: "Previous collection page" })
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
    await expect(preview).toBeHidden();
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
  const getDocumentPattern = PAGE_READ_PATTERN;
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page);
    const row = fixture.rows[0]!;
    const databasePageUrl = `/page/${fixture.databaseDocumentId}`;

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
        const document = { ...ownedDocument, ...role };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            url.pathname.endsWith("/get-page-open-read")
              ? { document }
              : document,
          ),
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
        name: "Discussion",
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
        has: page.getByRole("menuitem", { name: "Version history" }),
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

type PreviewFrame = {
  open: boolean;
  skeleton: boolean;
  placeholder: boolean;
  shareTop: number | null;
  shareLeft: number | null;
  propertyTop: number | null;
  bodyTop: number | null;
};

// Logs where the panel's fixed parts sit on every painted frame, so a switch
// that only flashes for a frame or two still shows up.
async function startPreviewFrameLog(page: Page) {
  await page.evaluate(() => {
    const log: PreviewFrame[] = [];
    const scope = window as unknown as { previewFrameLog?: PreviewFrame[] };
    scope.previewFrameLog = log;
    const top = (element: Element | null | undefined) =>
      element ? element.getBoundingClientRect().top : null;
    const sample = () => {
      if (scope.previewFrameLog !== log) return;
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (candidate) =>
          [...candidate.querySelectorAll("button")].some((button) =>
            button.textContent?.includes("Open page"),
          ),
      );
      const share = [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) =>
          (button.getAttribute("aria-label") ?? button.textContent)?.trim() ===
          "Share",
      );
      const placeholder = dialog?.querySelector(
        "[data-database-item-preview-placeholder]",
      );
      log.push({
        open: !!dialog,
        skeleton: !!dialog?.querySelector("[data-startup-anchor]"),
        placeholder: !!placeholder,
        shareTop: top(share),
        shareLeft: share ? share.getBoundingClientRect().left : null,
        propertyTop: top(dialog?.querySelector("[data-property-row]")),
        // The live editor mounts hidden behind the page's static copy, so only
        // the copy on screen counts.
        bodyTop: top(
          [...(dialog?.querySelectorAll(".visual-editor-wrapper") ?? [])].find(
            (wrapper) => wrapper.getClientRects().length > 0,
          ),
        ),
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function stopPreviewFrameLog(page: Page) {
  return page.evaluate(() => {
    const scope = window as unknown as { previewFrameLog?: PreviewFrame[] };
    const log = scope.previewFrameLog ?? [];
    delete scope.previewFrameLog;
    return log;
  });
}

function expectSteadySwitch(frames: PreviewFrame[]) {
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((frame) => !frame.open)).toEqual([]);
  expect(frames.filter((frame) => frame.skeleton)).toEqual([]);
  expect(frames.filter((frame) => frame.shareTop === null)).toEqual([]);
  expect(frames.filter((frame) => frame.propertyTop === null)).toEqual([]);
  for (const part of [
    "shareTop",
    "shareLeft",
    "propertyTop",
    "bodyTop",
  ] as const) {
    const positions = new Set(
      frames.flatMap((frame) => (frame[part] === null ? [] : [frame[part]])),
    );
    expect([...positions], `${part} stays put`).toHaveLength(1);
  }
}

test("a preview switches rows in place, from a row's title and from the arrows", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 3);
    const [rowA, rowB, rowC] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    const showing = async (row: PreviewRowFixture) => {
      await expect(preview.getByLabel("Document title")).toHaveValue(row.title);
      await expect(preview.locator(".ProseMirror")).toContainText(row.body);
    };

    await startPreviewFrameLog(page);
    await page
      .getByRole("button", { name: `Open ${rowC.title} preview` })
      .click();
    await showing(rowC);
    expectSteadySwitch(await stopPreviewFrameLog(page));
    await expect(
      page.getByRole("button", { name: `Open ${rowC.title} preview` }),
    ).toBeFocused();

    await startPreviewFrameLog(page);
    await preview
      .getByRole("button", { name: "Previous collection page" })
      .click();
    await showing(rowB);
    await preview
      .getByRole("button", { name: "Previous collection page" })
      .click();
    await showing(rowA);
    await preview.getByRole("button", { name: "Next collection page" }).click();
    await showing(rowB);
    expectSteadySwitch(await stopPreviewFrameLog(page));

    // The row already showing stays showing.
    await page
      .getByRole("button", { name: `Open ${rowB.title} preview` })
      .click();
    await showing(rowB);

    // Anywhere that doesn't open a row still dismisses.
    await page.getByText(rowA.propertyValue, { exact: true }).click();
    await expect(preview).toBeHidden();
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a preview draws the next row while its slow page read finishes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  const readPattern = PAGE_READ_PATTERN;
  let releaseRead = () => {};
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    // The panel reads the row its Next arrow leads to as soon as it opens.
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.route(readPattern, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("id") === rowB.documentId) await readHeld;
      await route.fallback();
    });
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    await startPreviewFrameLog(page);
    await preview.getByRole("button", { name: "Next collection page" }).click();
    const placeholder = preview.locator(
      "[data-database-item-preview-placeholder]",
    );
    await expect(placeholder).toContainText(rowB.title);
    await expect(placeholder.getByText("Share", { exact: true })).toBeVisible();
    await expect(preview.getByLabel("Document title")).toHaveCount(0);
    await expect(
      preview.getByRole("button", { name: "Next collection page" }),
    ).toBeDisabled();

    releaseRead();
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowB.body);
    const frames = await stopPreviewFrameLog(page);
    expect(frames.some((frame) => frame.placeholder)).toBe(true);
    expectSteadySwitch(frames);
  } finally {
    releaseRead();
    await page.unroute(readPattern);
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a preview's Row menu holds its place, and Duplicate waits for the page's read", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  const readPattern = PAGE_READ_PATTERN;
  let releaseRead = () => {};
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.route(readPattern, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("id") === rowB.documentId) await readHeld;
      await route.fallback();
    });
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);
    await preview.getByRole("button", { name: "Next collection page" }).click();
    await expect(
      preview.locator("[data-database-item-preview-placeholder]"),
    ).toContainText(rowB.title);

    const rowActions = preview.getByRole("button", {
      name: `Preview actions for ${rowB.title}`,
    });
    const duplicate = page.getByRole("menuitem", { name: "Duplicate row" });
    await rowActions.click();
    await expect(duplicate).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    releaseRead();
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await rowActions.click();
    await expect(duplicate).toBeVisible();
    await expect(duplicate).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  } finally {
    releaseRead();
    await page.unroute(readPattern);
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a preview's page doesn't wait for the row's slow Property read", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  const propertiesPattern =
    "**/_agent-native/actions/list-document-properties**";
  let releaseRead = () => {};
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    await page.route(propertiesPattern, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("documentId") === rowB.documentId) {
        await readHeld;
      }
      await route.fallback();
    });
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    await startPreviewFrameLog(page);
    await preview.getByRole("button", { name: "Next collection page" }).click();
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowB.body);
    await expect(preview.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );

    releaseRead();
    await expect(
      preview.getByRole("button", { name: "Edit Acceptance marker" }),
    ).toBeVisible();
    expectSteadySwitch(await stopPreviewFrameLog(page));
  } finally {
    releaseRead();
    await page.unroute(propertiesPattern);
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

// Whether the page has no action write out and none finished in the last 750 ms.
function trackActionWrites(page: Page): () => boolean {
  let writesOut = 0;
  let lastChange = Date.now();
  const count = (request: Request, by: number) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/_agent-native/actions/")
    ) {
      writesOut += by;
      lastChange = Date.now();
    }
  };
  page.on("request", (request) => count(request, 1));
  page.on("requestfinished", (request) => count(request, -1));
  page.on("requestfailed", (request) => count(request, -1));
  return () => writesOut === 0 && Date.now() - lastChange > 750;
}

test("a row's reads start when the pointer rests on it, and the switch uses them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  const getDocumentPattern = PAGE_READ_PATTERN;
  try {
    await ensureAuthenticatedLocalSession(page);
    // Three rows, since the row beside the open one is read when the panel opens.
    fixture = await createDatabaseFixture(page, 3);
    const [rowA, , rowC] = fixture.rows;
    let reads = 0;
    await page.route(getDocumentPattern, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("id") === rowC.documentId) reads += 1;
      await route.fallback();
    });
    const writesSettled = trackActionWrites(page);
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);
    expect(reads).toBe(0);
    // A write that lands while a page read is out spoils the read, so the
    // writes an opening panel sends finish before the pointer rests.
    await expect.poll(writesSettled, { timeout: 30_000 }).toBe(true);

    const rowCTitle = page.getByRole("button", {
      name: `Open ${rowC.title} preview`,
    });
    await rowCTitle.hover();
    await expect.poll(() => reads).toBe(1);

    await rowCTitle.click();
    await expect(preview.getByLabel("Document title")).toHaveValue(rowC.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowC.body);
    expect(reads).toBe(1);
  } finally {
    await page.unroute(getDocumentPattern);
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a row's title saves the preview's edits before it switches", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    const editor = preview.locator(".ProseMirror");
    await expect(editor).toContainText(rowA.body);

    const marker = `Row switch edit ${Date.now()}`;
    await editor.fill(`${rowA.body}\n\n${marker}`);
    await page
      .getByRole("button", { name: `Open ${rowB.title} preview` })
      .click();
    await expect(preview.getByLabel("Document title")).toHaveValue(rowB.title);
    await expect(editor).toContainText(rowB.body);
    await expect(editor).not.toContainText(marker);

    const persisted = await readAction(page, "get-document", {
      id: rowA.documentId,
      databaseId: fixture.databaseId,
      databaseDocumentId: fixture.databaseDocumentId,
    });
    expect(String(persisted.content)).toContain(marker);
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

// Leaves a title edit in the panel saving until the returned release is called.
async function holdPreviewSave(page: Page, preview: Locator, title: string) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route(
    "**/_agent-native/actions/update-document**",
    async (route) => {
      saving = true;
      await held;
      await route.fallback();
    },
  );
  await preview.getByLabel("Document title").fill(title);
  return { release, saveStarted: () => expect.poll(() => saving).toBe(true) };
}

test("choosing the row on show takes back a switch waiting on its save", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  let release = () => {};
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 2);
    const [rowA, rowB] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    const editedTitle = `${rowA.title} edited`;
    const save = await holdPreviewSave(page, preview, editedTitle);
    release = save.release;
    await page
      .getByRole("button", { name: `Open ${rowB.title} preview` })
      .click();
    await save.saveStarted();
    await page
      .locator(`button[data-database-row-open="${rowA.documentId}"]`)
      .click();
    release();

    await expect
      .poll(async () => {
        const saved = await readAction(page, "get-document", {
          id: rowA.documentId,
          databaseId: fixture!.databaseId,
          databaseDocumentId: fixture!.databaseDocumentId,
        });
        return saved.title;
      })
      .toBe(editedTitle);
    await page.waitForTimeout(500);
    await expect(preview.getByLabel("Document title")).toHaveValue(editedTitle);
  } finally {
    release();
    await page.unroute("**/_agent-native/actions/update-document**");
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("an arrow pressed while a switch waits on its save steps on from that switch's row", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  let release = () => {};
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 3);
    const [rowA, , rowC] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    const save = await holdPreviewSave(page, preview, `${rowA.title} edited`);
    release = save.release;
    const next = preview.getByRole("button", { name: "Next collection page" });
    await next.click();
    await save.saveStarted();
    await next.click();
    release();

    await expect(preview.getByLabel("Document title")).toHaveValue(rowC.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowC.body);
  } finally {
    release();
    await page.unroute("**/_agent-native/actions/update-document**");
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a switch waiting on its save doesn't follow someone who left the collection", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  let release = () => {};
  try {
    await ensureAuthenticatedLocalSession(page);
    fixture = await createDatabaseFixture(page, 1);
    const [rowA] = fixture.rows;
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });
    const preview = await openPreview(page, rowA.title);
    await expect(preview.locator(".ProseMirror")).toContainText(rowA.body);

    const editedTitle = `${rowA.title} edited`;
    const save = await holdPreviewSave(page, preview, editedTitle);
    release = save.release;
    await preview
      .getByRole("button", { name: "Open page", exact: true })
      .click();
    await save.saveStarted();
    await page.getByRole("link", { name: "Trash" }).click();
    await expect(page).toHaveURL(/\/trash/);
    release();

    await expect
      .poll(async () => {
        const saved = await readAction(page, "get-document", {
          id: rowA.documentId,
          databaseId: fixture!.databaseId,
          databaseDocumentId: fixture!.databaseDocumentId,
        });
        return saved.title;
      })
      .toBe(editedTitle);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/trash/);
  } finally {
    release();
    await page.unroute("**/_agent-native/actions/update-document**");
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

async function clipboardText(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

function discussionComposer(page: Page) {
  return page.locator("[data-discussion-composer] [contenteditable='true']");
}

test("a collection row's menu copies its link and starts a comment on its page", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  try {
    await ensureAuthenticatedLocalSession(page);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    fixture = await createDatabaseFixture(page);
    const row = fixture.rows[0]!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });

    const rowActions = page.getByRole("button", {
      name: `Row actions for ${row.title}`,
    });
    const rowMenu = page.getByRole("menu").filter({
      has: page.getByRole("menuitem", { name: "Open page" }),
    });
    await rowActions.click();
    await rowMenu
      .getByRole("menuitem", { name: "Copy link", exact: true })
      .click();
    await expect(page.getByText("Copied page link")).toBeVisible();
    await expect(rowMenu).toHaveCount(0);
    expect(await clipboardText(page)).toBe(`${origin}/p/${row.documentId}`);

    await rowActions.focus();
    await page.keyboard.press("Enter");
    await expect(
      rowMenu.getByRole("menuitem", { name: "Open page" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      rowMenu.getByRole("menuitem", { name: "Copy link", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const comment = rowMenu.getByRole("menuitem", {
      name: "Comment",
      exact: true,
    });
    await expect(comment).toBeFocused();
    await page.keyboard.press("Enter");

    const preview = previewDialog(page);
    await expect(preview).toBeVisible();
    await expect(preview.getByLabel("Document title")).toHaveValue(row.title);
    await expect(discussionComposer(page)).toBeFocused();
    const text = `Row menu comment ${Date.now()}`;
    await page.keyboard.type(text);
    await page
      .locator("[data-discussion-composer]")
      .getByRole("button", { name: "Comment", exact: true })
      .click();
    await expect
      .poll(async () => {
        const listed = await readAction(page, "list-comments", {
          documentId: row.documentId,
        });
        return (listed.comments as ActionResult[]).map(
          (entry) => entry.content,
        );
      })
      .toContain(text);

    // A full-page row opens the same way from its link, comment kept.
    await page.goto(`/page/${row.documentId}?commentPage=1`, {
      waitUntil: "domcontentloaded",
    });
    await expect(discussionComposer(page)).toBeFocused();
    await expect(page.getByText(text)).toBeVisible();
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test("a collection view's menu copies a link that opens that view", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  let fixture: DatabaseFixture | null = null;
  try {
    await ensureAuthenticatedLocalSession(page);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    fixture = await createDatabaseFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/page/${fixture.databaseDocumentId}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: "Add collection view" }).click();
    await page.getByLabel("New view name").fill("Second");
    await page.keyboard.press("Enter");
    const second = page.getByRole("button", { name: "Second view menu" });
    await expect(second).toBeVisible();

    await second.click();
    await page.getByRole("menuitem", { name: "Copy link to view" }).click();
    await expect(page.getByText("Copied view link")).toBeVisible();
    const link = new URL(await clipboardText(page));
    expect(link.origin).toBe(origin);
    expect(link.pathname).toBe(`/page/${fixture.databaseDocumentId}`);
    expect(link.searchParams.get("databaseId")).toBe(fixture.databaseId);
    expect(link.searchParams.get("viewId")).toBeTruthy();

    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Table view menu" }),
    ).toBeVisible();
    await page.goto(link.href, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Second view menu" }),
    ).toBeVisible();
  } finally {
    if (fixture) await cleanupDatabaseFixture(page, fixture);
  }
});

test.describe("collection menus on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("shows a row's menu and Add view without hover, and taps a row's Comment", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    let fixture: DatabaseFixture | null = null;
    try {
      await ensureAuthenticatedLocalSession(page);
      fixture = await createDatabaseFixture(page);
      const row = fixture.rows[0]!;
      await page.goto(`/page/${fixture.databaseDocumentId}`, {
        waitUntil: "domcontentloaded",
      });
      expect(
        await page.evaluate(() => matchMedia("(any-hover: none)").matches),
      ).toBe(true);

      const rowActions = page.getByRole("button", {
        name: `Row actions for ${row.title}`,
      });
      await rowActions.scrollIntoViewIfNeeded();
      await expect(rowActions).toHaveCSS("opacity", "1");
      await expect(
        page.getByRole("button", { name: "Add collection view" }),
      ).toHaveCSS("opacity", "1");

      await rowActions.tap();
      await page.getByRole("menuitem", { name: "Comment", exact: true }).tap();
      await expect(previewDialog(page)).toBeVisible();
      await expect(discussionComposer(page)).toBeFocused();
    } finally {
      if (fixture) await cleanupDatabaseFixture(page, fixture);
    }
  });
});
