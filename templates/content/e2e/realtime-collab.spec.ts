import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { getDocument } from "./helpers";

const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

async function runAction(
  page: Page,
  name: string,
  data: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await page.request.post(`/_agent-native/actions/${name}`, {
    data,
    headers: ACTION_HEADERS,
  });
  const result = (await response.json().catch(() => ({}))) as Record<
    string,
    any
  >;
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 300)}`,
  ).toBeTruthy();
  return result;
}

async function registerUser(
  context: BrowserContext,
  baseURL: string,
  email: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseURL}/sign-in`, { waitUntil: "domcontentloaded" });
  const password = "example-content-realtime-pw";
  const headers = { Origin: baseURL, Referer: `${baseURL}/sign-in` };
  await page.request.post("/_agent-native/auth/register", {
    data: { email, password, name: "Collab tester", callbackURL: "/" },
    headers,
  });
  const login = await page.request.post("/_agent-native/auth/login", {
    data: { email, password },
    headers,
  });
  expect(login.ok()).toBe(true);
  return page;
}

async function gotoDocument(page: Page, documentId: string, editable = true) {
  await page.goto(`/page/${documentId}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  // Typing before the editor binds to the collaborative doc is dropped.
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    String(editable),
    { timeout: 60_000 },
  );
}

// Block texts without remote-caret labels, which render inside the editor.
function blocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(document.querySelector(".ProseMirror")?.children ?? [])].map(
      (element) => {
        const copy = element.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll(
            ".collaboration-carets__caret,.collaboration-carets__label,.ProseMirror-yjs-cursor",
          )
          .forEach((node) => node.remove());
        return copy.textContent ?? "";
      },
    ),
  );
}

async function caretAtEnd(page: Page, blockIndex: number) {
  await page.locator(".ProseMirror > *").nth(blockIndex).click();
  // Playwright clicks the block's center; settle before moving the caret.
  await page.waitForTimeout(300);
  await page.keyboard.press("End");
}

test.describe("real-time collaboration between two signed-in users", () => {
  test("converges concurrent typing, keeps undo per user, and shows edits and comments to a viewer", async ({
    page: owner,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error("playwright baseURL is not configured");
    const root = baseURL;
    const stamp = Date.now();
    const editorEmail = `realtime-editor+autoz-${stamp}@content.test`;
    const viewerEmail = `realtime-viewer+autoz-${stamp}@content.test`;
    const editorContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    let documentId: string | undefined;

    try {
      const editor = await registerUser(editorContext, root, editorEmail);
      const viewer = await registerUser(viewerContext, root, viewerEmail);
      const created = await runAction(owner, "create-document", {
        title: `Realtime collab ${stamp}`,
        content: "Paragraph one.\n\nParagraph two.\n\nParagraph three.\n",
      });
      documentId = String(created.id);
      for (const [email, role] of [
        [editorEmail, "editor"],
        [viewerEmail, "viewer"],
      ]) {
        await runAction(owner, "share-resource", {
          resourceType: "document",
          resourceId: documentId,
          principalType: "user",
          principalId: email,
          role,
          notify: false,
        });
      }

      await Promise.all([
        gotoDocument(owner, documentId),
        gotoDocument(editor, documentId),
        gotoDocument(viewer, documentId, false),
      ]);

      // Concurrent typing in different paragraphs converges for everyone.
      await caretAtEnd(owner, 0);
      await caretAtEnd(editor, 2);
      await Promise.all([
        owner.keyboard.type(" owner-typed", { delay: 25 }),
        editor.keyboard.type(" editor-typed", { delay: 25 }),
      ]);
      const converged = [
        "Paragraph one. owner-typed",
        "Paragraph two.",
        "Paragraph three. editor-typed",
      ];
      for (const page of [owner, editor, viewer]) {
        await expect
          .poll(() => blocks(page), { timeout: 15_000 })
          .toEqual(converged);
      }
      await expect(viewer.locator(".ProseMirror")).toHaveAttribute(
        "contenteditable",
        "false",
      );

      // Undo removes only the undoing user's text.
      await owner.keyboard.press("ControlOrMeta+z");
      for (const page of [owner, editor, viewer]) {
        await expect
          .poll(() => blocks(page), { timeout: 15_000 })
          .toEqual([
            "Paragraph one.",
            "Paragraph two.",
            "Paragraph three. editor-typed",
          ]);
      }

      // A collaborator's comment reaches the other open editors without a reload.
      await owner
        .locator(".ProseMirror p", { hasText: "Paragraph two" })
        .dblclick({ position: { x: 60, y: 10 } });
      await owner.getByRole("button", { name: "Comment", exact: true }).click();
      await owner.locator(".agent-composer-prosemirror").last().click();
      await owner.keyboard.type("Looks good", { delay: 20 });
      await owner.keyboard.press("Enter");
      for (const page of [editor, viewer]) {
        await expect(
          page.locator(".ProseMirror .comment-highlight"),
        ).toHaveCount(1, { timeout: 45_000 });
      }
    } finally {
      await editorContext.close();
      await viewerContext.close();
      if (documentId) {
        await runAction(owner, "delete-document", { id: documentId }).catch(
          () => undefined,
        );
      }
    }
  });

  test("concurrent typing reaches SQL for both authors without another keystroke, over polling", async ({
    page: owner,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error("playwright baseURL is not configured");
    const stamp = Date.now();
    const editorEmail = `durable-editor+autoz-${stamp}@content.test`;
    const editorContext = await browser.newContext();
    let documentId: string | undefined;

    try {
      // Serverless hosts answer the realtime stream with 204, leaving /poll
      // as the only channel between the two editors.
      for (const context of [owner.context(), editorContext]) {
        await context.route("**/_agent-native/events**", (route) =>
          route.fulfill({ status: 204, body: "" }),
        );
      }
      const editor = await registerUser(editorContext, baseURL, editorEmail);
      const created = await runAction(owner, "create-document", {
        title: `Durable collab ${stamp}`,
        content: "Paragraph one.\n\nParagraph two.\n\nParagraph three.\n",
      });
      documentId = String(created.id);
      await runAction(owner, "share-resource", {
        resourceType: "document",
        resourceId: documentId,
        principalType: "user",
        principalId: editorEmail,
        role: "editor",
        notify: false,
      });
      await Promise.all([
        gotoDocument(owner, documentId),
        gotoDocument(editor, documentId),
      ]);

      // Typing at the same spot: each save carries only its author's text,
      // and the server keeps just one of two overlapping saves. Repeat so a
      // save that lands in the unlucky order is not missed.
      const typed: string[] = [];
      for (const round of ["alpha", "beta", "gamma"]) {
        await caretAtEnd(owner, 1);
        await caretAtEnd(editor, 1);
        const ownerWords = ` owner-${round} one two three`;
        const editorWords = ` editor-${round} one two three`;
        await Promise.all([
          owner.keyboard.type(ownerWords, { delay: 50 }),
          editor.keyboard.type(editorWords, { delay: 50 }),
        ]);
        typed.push(ownerWords.trim(), editorWords.trim());
        for (const page of [owner, editor]) {
          await expect
            .poll(
              async () => {
                const text = (await blocks(page))[1] ?? "";
                return typed.every((words) => text.includes(words));
              },
              { timeout: 30_000 },
            )
            .toBe(true);
        }

        // Anyone who reads SQL (an agent, a viewer's saved copy) must see
        // both authors' text once the editors agree, with nobody typing.
        await expect
          .poll(
            async () => {
              const { content = "" } = await getDocument(owner, documentId!);
              return typed.every((words) => content.includes(words));
            },
            { timeout: 30_000, message: `SQL after round ${round}` },
          )
          .toBe(true);
      }
      const { content = "" } = await getDocument(owner, documentId);
      for (const words of typed) {
        expect(content.split(words).length - 1, words).toBe(1);
      }
    } finally {
      await editorContext.close();
      if (documentId) {
        await runAction(owner, "delete-document", { id: documentId }).catch(
          () => undefined,
        );
      }
    }
  });

  test("a lone editor's typing burst is saved once", async ({
    page: owner,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error("playwright baseURL is not configured");
    const created = await runAction(owner, "create-document", {
      title: `Lone save ${Date.now()}`,
      content: "Paragraph one.\n\nParagraph two.\n",
    });
    const documentId = String(created.id);
    try {
      await gotoDocument(owner, documentId);
      let saves = 0;
      owner.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().includes("/actions/update-document")
        )
          saves += 1;
      });
      await caretAtEnd(owner, 1);
      await owner.keyboard.type(" typed alone in one burst", { delay: 40 });
      await expect
        .poll(async () => (await getDocument(owner, documentId)).content, {
          timeout: 20_000,
        })
        .toContain("typed alone in one burst");
      // Past the settle delay a converged-document save would have fired.
      await owner.waitForTimeout(5_000); // e2e-harness-ignore: proving no extra save follows means waiting for one
      expect(saves).toBe(1);
    } finally {
      await runAction(owner, "delete-document", { id: documentId }).catch(
        () => undefined,
      );
    }
  });
});
