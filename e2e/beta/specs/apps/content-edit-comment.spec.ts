import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  purgeContentPage,
  readContentAction,
  runContentAction,
} from "../../lib/content-pages";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));

test("Content beta saves a page edit and comment", async ({ browser }) => {
  test.skip(!selected.has("content"), "content is not in this run's selection");

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
    await runContentAction(page, origin, "create-document", {
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
            (await readContentAction(page, origin, "get-document", { id }))
              .content,
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
      await readContentAction(page, origin, "list-comments", {
        documentId: id,
      })
    ).comments as Array<{ content?: string }>;
    expect(comments.some((entry) => entry.content === comment)).toBe(true);
  } finally {
    try {
      await purgeContentPage(page, origin, id, marker);
    } finally {
      await context.close();
    }
  }
});
