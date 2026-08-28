import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

type ActionResult = Record<string, any>;

async function runAction(
  page: Page,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await page.request.post(`/_agent-native/actions/${name}`, {
    data,
    headers: ACTION_HEADERS,
  });
  const result = (await response.json().catch(() => ({}))) as ActionResult;
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBeTruthy();
  return result;
}

async function getAction(
  page: Page,
  name: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; status: number; result: ActionResult }> {
  return page.evaluate(
    async ({ name, data, headers }) => {
      const query = new URLSearchParams(data);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch(
            `/_agent-native/actions/${name}?${query.toString()}`,
            { headers },
          );
          const value = {
            ok: response.ok,
            status: response.status,
            result: (await response.json().catch(() => ({}))) as ActionResult,
          };
          if (response.status < 500 || attempt === 4) return value;
        } catch {
          if (attempt === 4) throw new Error(`${name} read-back failed`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`${name} read-back exhausted retries`);
    },
    { name, data, headers: ACTION_HEADERS },
  );
}

async function getCollabState(page: Page, documentId: string) {
  const response = await page.request.get(
    `/_agent-native/collab/${documentId}/state`,
  );
  expect(response.ok(), `collab state should load (${response.status()})`).toBe(
    true,
  );
  return response.text();
}

async function getStableCollabState(page: Page, documentId: string) {
  let previous = await getCollabState(page, documentId);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    const current = await getCollabState(page, documentId);
    if (current === previous) return current;
    previous = current;
  }
  throw new Error("collaboration state did not settle");
}

async function registerRecipient(
  context: BrowserContext,
  baseURL: string,
  email: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseURL}/sign-in`, { waitUntil: "domcontentloaded" });
  const password = "example-content-shared-page-pw";
  const authHeaders = { Origin: baseURL, Referer: `${baseURL}/sign-in` };
  await page.request.post("/_agent-native/auth/register", {
    data: {
      email,
      password,
      name: "Shared page recipient",
      callbackURL: "/",
    },
    headers: authHeaders,
  });
  const login = await page.request.post("/_agent-native/auth/login", {
    data: { email, password },
    headers: authHeaders,
  });
  expect(login.ok()).toBe(true);
  const session = await page.request.get("/_agent-native/auth/session");
  expect((await session.json()).email).toBe(email);
  return page;
}

test("an editor can read and edit one shared Personal page without gaining its private container", async ({
  page: owner,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(360_000);
  const marker = `QA shared Personal bc4a2441 ${Date.now()}`;
  const originalBody = `${marker} original body`;
  const editedBody = `${marker} recipient edit`;
  const recipientEmail = `shared-personal+qa-${Date.now()}@content.test`;
  const createdIds: string[] = [];
  const recipientContext = await browser.newContext();
  const recipient = await registerRecipient(
    recipientContext,
    baseURL ?? "http://127.0.0.1:8090",
    recipientEmail,
  );

  try {
    const pageResult = await runAction(owner, "create-document", {
      title: `${marker} page`,
      content: originalBody,
    });
    const documentId = String(pageResult.id);
    createdIds.push(documentId);
    const siblingResult = await runAction(owner, "create-document", {
      title: `${marker} private sibling`,
      content: `${marker} private sibling body`,
    });
    const siblingId = String(siblingResult.id);
    createdIds.push(siblingId);

    await owner.goto(`/page/${documentId}`, { waitUntil: "domcontentloaded" });
    await expect(owner.getByLabel("Document title")).toHaveValue(
      `${marker} page`,
    );
    await expect(owner.locator(".ProseMirror")).toContainText(originalBody);

    await owner.getByRole("button", { name: "Share", exact: true }).click();
    await owner.getByPlaceholder(/Add people/).fill(recipientEmail);
    await owner.getByRole("combobox", { name: "Role" }).click();
    await owner.getByRole("option", { name: "Editor", exact: true }).click();
    await owner.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      owner.getByText(recipientEmail, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const shares = await getAction(owner, "list-resource-shares", {
            resourceType: "document",
            resourceId: documentId,
          });
          expect(shares.ok).toBe(true);
          return shares.result.shares;
        },
        { timeout: 20_000 },
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            principalType: "user",
            principalId: recipientEmail,
            role: "editor",
          }),
        ]),
      );

    await recipient.goto(`/page/${documentId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(recipient.getByLabel("Document title")).toHaveValue(
      `${marker} page`,
    );
    const editor = recipient.locator(".ProseMirror");
    await expect(editor).toContainText(originalBody);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.fill(editedBody);
    await expect(editor).toContainText(editedBody);
    await recipient.waitForTimeout(1_500);

    await testInfo.attach("recipient-shared-personal-page", {
      body: await recipient.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    const sharedRead = await getAction(recipient, "get-document", {
      id: documentId,
    });
    expect(sharedRead.ok).toBe(true);
    expect(sharedRead.result.content).toContain(editedBody);
    await owner.reload({ waitUntil: "domcontentloaded" });
    await expect(owner.locator(".ProseMirror")).toContainText(marker);
    await expect(owner.locator(".ProseMirror")).toContainText("recipient edit");
    const persistedCollabBaseline = await getStableCollabState(
      owner,
      documentId,
    );

    const siblingRead = await getAction(recipient, "get-document", {
      id: siblingId,
    });
    expect(siblingRead.ok).toBe(false);
    expect([403, 404]).toContain(siblingRead.status);

    const recipientDocuments = await getAction(recipient, "list-documents", {});
    expect(recipientDocuments.ok).toBe(true);
    const visibleIds = (recipientDocuments.result.documents ?? []).map(
      (document: { id?: string }) => document.id,
    );
    expect(visibleIds).toContain(documentId);
    expect(visibleIds).not.toContain(siblingId);

    for (const status of [403, 404, 500]) {
      await test.step(`collaboration ${status} fails closed and recovers explicitly`, async () => {
        let failureActive = true;
        const collabFailureRoute = async (route: Route) => {
          if (!failureActive) return route.fallback();
          await route.fulfill({
            status,
            headers: { "cache-control": "no-store" },
            body: "injected initialization failure",
          });
        };
        await recipient.route(
          `**/_agent-native/collab/${documentId}/state**`,
          collabFailureRoute,
        );
        await recipient.reload({ waitUntil: "domcontentloaded" });
        await expect(
          recipient.locator("[data-collab-initialization-error]"),
        ).toBeVisible();
        await expect(recipient.locator(".ProseMirror")).toHaveAttribute(
          "contenteditable",
          "false",
        );
        const unchanged = await getAction(owner, "get-document", {
          id: documentId,
        });
        expect(unchanged.result.content).toContain(editedBody);
        expect(await getCollabState(owner, documentId)).toBe(
          persistedCollabBaseline,
        );
        failureActive = false;
        await recipient.getByRole("button", { name: "Retry" }).click();
        await expect(
          recipient.locator("[data-collab-initialization-error]"),
        ).not.toBeVisible();
        await expect(recipient.locator(".ProseMirror")).toHaveAttribute(
          "contenteditable",
          "true",
        );
        await expect(recipient.locator(".ProseMirror")).toContainText(
          editedBody,
        );
        await recipient.unrouteAll({ behavior: "wait" });
      });
    }

    let collabNetworkFailureActive = true;
    const collabNetworkFailureRoute = async (route: Route) =>
      collabNetworkFailureActive
        ? route.abort("connectionfailed")
        : route.fallback();
    await recipient.route(
      `**/_agent-native/collab/${documentId}/state**`,
      collabNetworkFailureRoute,
    );
    await recipient.reload({ waitUntil: "domcontentloaded" });
    await expect(
      recipient.locator("[data-collab-initialization-error]"),
    ).toBeVisible();
    await expect(recipient.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    const unchanged = await getAction(owner, "get-document", {
      id: documentId,
    });
    expect(unchanged.result.content).toContain(editedBody);
    expect(await getCollabState(owner, documentId)).toBe(
      persistedCollabBaseline,
    );
    collabNetworkFailureActive = false;

    await recipient.getByRole("button", { name: "Retry" }).click();
    await expect(recipient.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    await expect(recipient.locator(".ProseMirror")).toContainText(editedBody);
    await recipient.unrouteAll({ behavior: "wait" });

    for (const failure of [403, 404, 500, "network"] as const) {
      let propertyFailureActive = true;
      const propertyRoute = async (route: Route) => {
        if (!propertyFailureActive) return route.fallback();
        if (failure === "network") {
          await route.abort("connectionfailed");
        } else {
          await route.fulfill({
            status: failure,
            headers: { "cache-control": "no-store" },
            body: "injected property initialization failure",
          });
        }
      };
      await recipient.route(
        "**/_agent-native/actions/list-document-properties**",
        propertyRoute,
      );
      await recipient.reload({ waitUntil: "domcontentloaded" });
      await expect(
        recipient.locator('[data-block-fields-state="error"]'),
      ).toBeVisible();
      propertyFailureActive = false;
      await recipient.getByRole("button", { name: "Retry" }).click();
      await expect(
        recipient.locator('[data-block-fields-state="error"]'),
      ).toHaveCount(0);
      const propertyFailureUnchanged = await getAction(owner, "get-document", {
        id: documentId,
      });
      expect(propertyFailureUnchanged.result.content).toContain(editedBody);
      expect(await getCollabState(owner, documentId)).toBe(
        persistedCollabBaseline,
      );
      await expect(recipient.locator(".ProseMirror")).toContainText(editedBody);
      await recipient.unrouteAll({ behavior: "wait" });
    }
  } finally {
    await recipientContext.close();
    for (const id of createdIds.reverse()) {
      await runAction(owner, "delete-document", { id });
      await runAction(owner, "permanently-delete-document", { id });
    }
  }
});
