import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, siteById } from "../../lib/fleet";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "../../lib/test-traffic";

skipUnlessAuthed();

const ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

type ActionResult = Record<string, unknown>;

async function runAction(
  page: import("@playwright/test").Page,
  origin: string,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await page.request.post(
    `${origin}/_agent-native/actions/${name}`,
    { data, headers: ACTION_HEADERS },
  );
  const result = (await response.json().catch(() => ({}))) as ActionResult;
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBe(true);
  return result;
}

async function readAction(
  page: import("@playwright/test").Page,
  origin: string,
  name: string,
  data: Record<string, string>,
): Promise<ActionResult> {
  const response = await page.request.get(
    `${origin}/_agent-native/actions/${name}`,
    { params: data, headers: ACTION_HEADERS },
  );
  const result = (await response.json().catch(() => ({}))) as ActionResult;
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBe(true);
  return result;
}

test("Content beta saves a page edit and comment", async ({ browser }) => {
  const site = siteById("content");
  const origin = originFor(site);
  const context = await signedInContext(browser, site, { seedModel: false });
  const page = await context.newPage();
  const id = crypto.randomUUID();
  const marker = `${runMarker("content edit and comment")} ${id}`;
  const originalBody = `${marker} original`;
  const editedBody = `${marker} edited`;
  const comment = `${marker} comment`;

  try {
    await assertSignedInOnBeta(context, site);
    await runAction(page, origin, "create-document", {
      id,
      title: marker,
      content: originalBody,
    });

    await page.goto(`${origin}/page/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const editor = page.locator(".notion-editor.ProseMirror");
    await expect(editor).toHaveAttribute("contenteditable", "true", {
      timeout: 60_000,
    });
    await expect(editor).toContainText(originalBody, { timeout: 60_000 });
    await editor.fill(editedBody);
    await expect
      .poll(
        async () =>
          String(
            (await readAction(page, origin, "get-document", { id })).content,
          ),
        { timeout: 60_000 },
      )
      .toContain(editedBody);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await expect(editor).toHaveAttribute("contenteditable", "true", {
      timeout: 60_000,
    });
    await expect(editor).toContainText(editedBody, { timeout: 60_000 });

    await editor.selectText();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const pendingComment = page.locator("[data-comment-pending]");
    await expect(pendingComment).toBeVisible();
    await pendingComment.locator('[contenteditable="true"]').fill(comment);
    const savedComment = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/actions/add-comment") &&
        response.request().method() === "POST",
    );
    await pendingComment.locator("button[data-comment-send]").click();
    expect((await savedComment).ok()).toBe(true);

    const comments = (
      await readAction(page, origin, "list-comments", {
        documentId: id,
      })
    ).comments as Array<{ content?: string }>;
    expect(comments.some((entry) => entry.content === comment)).toBe(true);
  } finally {
    try {
      const document = await page.request.get(
        `${origin}/_agent-native/actions/get-document`,
        { params: { id }, headers: ACTION_HEADERS },
      );
      if (document.ok()) {
        await runAction(page, origin, "delete-document", { id });
      } else if (document.status() !== 404) {
        throw new Error(
          `Could not verify test document cleanup (${document.status()})`,
        );
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const trash = await readAction(page, origin, "list-content-trash", {
          query: marker,
        });
        const items = trash.items as Array<{ documentId?: string }>;
        if (!items.some((item) => item.documentId === id)) break;

        try {
          const plan = await runAction(
            page,
            origin,
            "plan-content-trash-purge",
            {
              mode: "selection",
              documentIds: [id],
            },
          );
          await runAction(page, origin, "permanently-delete-document", {
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
          headers: ACTION_HEADERS,
        }),
        readAction(page, origin, "list-content-trash", { query: marker }),
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
    } finally {
      await context.close();
    }
  }
});
