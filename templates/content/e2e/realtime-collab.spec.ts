import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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

async function openEditor(page: Page, documentId: string, editable = true) {
  await page.goto(`/page/${documentId}`, { waitUntil: "domcontentloaded" });
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
    const root = baseURL ?? "http://127.0.0.1:8090";
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
        openEditor(owner, documentId),
        openEditor(editor, documentId),
        openEditor(viewer, documentId, false),
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
});
