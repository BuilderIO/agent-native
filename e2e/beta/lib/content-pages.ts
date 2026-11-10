import { expect, type APIResponse, type Page } from "@playwright/test";

import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./test-traffic";

export const CONTENT_ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-video-block-ids-v1",
  "X-Agent-Native-Build-Id": "development",
};

type ActionResult = Record<string, unknown>;

async function actionResult(
  name: string,
  response: APIResponse,
): Promise<ActionResult> {
  const text = await response.text();
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${text.slice(0, 500)}`,
  ).toBe(true);
  return JSON.parse(text) as ActionResult;
}

export async function runContentAction(
  page: Page,
  origin: string,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  return actionResult(
    name,
    await page.request.post(`${origin}/_agent-native/actions/${name}`, {
      data,
      headers: CONTENT_ACTION_HEADERS,
    }),
  );
}

export async function readContentAction(
  page: Page,
  origin: string,
  name: string,
  data: Record<string, string>,
): Promise<ActionResult> {
  return actionResult(
    name,
    await page.request.get(`${origin}/_agent-native/actions/${name}`, {
      params: data,
      headers: CONTENT_ACTION_HEADERS,
    }),
  );
}

/**
 * Open a page on the Content origin holding the browser UI capability the app
 * mints. Approval-gated actions such as Delete forever accept only the
 * signed-in app's own calls, so the same call over `page.request` gets a 403.
 */
async function openContentApp(page: Page, origin: string): Promise<Page> {
  const app = await page.context().newPage();
  try {
    // A small same-origin document is enough: the mint and the calls need
    // only a page on this origin, not the whole app.
    await app.goto(`${origin}/_agent-native/auth/session`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const minted = await app.evaluate(async () => {
      const response = await fetch("/_agent-native/ui-capability", {
        credentials: "same-origin",
        cache: "no-store",
      });
      await response.arrayBuffer();
      return response.status;
    });
    expect(minted, "Content should mint the browser UI capability").toBe(200);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function runContentActionInApp(
  app: Page,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const { status, text } = await app.evaluate(
    async ({ name, data, headers }) => {
      const response = await fetch(`/_agent-native/actions/${name}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return { status: response.status, text: await response.text() };
    },
    { name, data, headers: CONTENT_ACTION_HEADERS },
  );
  expect(
    status >= 200 && status < 300,
    `${name} should succeed (${status}): ${text.slice(0, 500)}`,
  ).toBe(true);
  return JSON.parse(text) as ActionResult;
}

/**
 * Delete a test page, purge it from Trash, and prove both are gone. Beta shares
 * its database with production, so a fixture that survives a run is a leak.
 */
export async function purgeContentPage(
  page: Page,
  origin: string,
  id: string,
  marker: string,
): Promise<void> {
  const document = await page.request.get(
    `${origin}/_agent-native/actions/get-document`,
    { params: { id }, headers: CONTENT_ACTION_HEADERS },
  );
  if (document.ok()) {
    await runContentAction(page, origin, "delete-document", { id });
  } else if (document.status() !== 404) {
    throw new Error(
      `Could not verify test document cleanup (${document.status()})`,
    );
  }

  let app: Page | undefined;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const trash = await readContentAction(
        page,
        origin,
        "list-content-trash",
        { query: marker },
      );
      const items = trash.items as Array<{ documentId?: string }>;
      if (!items.some((item) => item.documentId === id)) break;

      try {
        app ??= await openContentApp(page, origin);
        const plan = await runContentActionInApp(
          app,
          "plan-content-trash-purge",
          { mode: "selection", documentIds: [id] },
        );
        await runContentActionInApp(app, "permanently-delete-document", {
          id,
          planId: plan.planId,
          scopeToken: plan.scopeToken,
        });
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  } finally {
    await app?.close();
  }

  const [remainingDocument, remainingTrash] = await Promise.all([
    page.request.get(`${origin}/_agent-native/actions/get-document`, {
      params: { id },
      headers: CONTENT_ACTION_HEADERS,
    }),
    readContentAction(page, origin, "list-content-trash", { query: marker }),
  ]);
  if (remainingDocument.ok() || remainingDocument.status() !== 404) {
    throw new Error(
      `Test document remains after cleanup (${remainingDocument.status()})`,
    );
  }
  if (
    (remainingTrash.items as Array<{ documentId?: string }>).some(
      (item) => item.documentId === id,
    )
  ) {
    throw new Error("Test document remains in Content Trash after cleanup");
  }
}
