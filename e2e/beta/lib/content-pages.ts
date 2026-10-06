import { expect, type APIResponse, type Page } from "@playwright/test";

import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./test-traffic";

export const CONTENT_ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
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

  for (let attempt = 0; attempt < 2; attempt++) {
    const trash = await readContentAction(page, origin, "list-content-trash", {
      query: marker,
    });
    const items = trash.items as Array<{ documentId?: string }>;
    if (!items.some((item) => item.documentId === id)) break;

    try {
      const plan = await runContentAction(
        page,
        origin,
        "plan-content-trash-purge",
        {
          mode: "selection",
          documentIds: [id],
        },
      );
      await runContentAction(page, origin, "permanently-delete-document", {
        id,
        planId: plan.planId,
        scopeToken: plan.scopeToken,
      });
    } catch (error) {
      if (attempt === 1) throw error;
    }
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
