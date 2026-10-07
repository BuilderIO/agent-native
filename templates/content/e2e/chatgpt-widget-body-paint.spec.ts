import { expect, test, type Page } from "@playwright/test";

import { createPage, postAction } from "./helpers";

async function removeDocument(page: Page, id: string) {
  await postAction(page, "delete-document", { id });
  const plan = await postAction<{
    planId?: string;
    scopeToken?: string;
  }>(page, "plan-content-trash-purge", {
    mode: "selection",
    documentIds: [id],
  });
  if (!plan.planId || !plan.scopeToken) return;
  await postAction(page, "permanently-delete-document", {
    id,
    planId: plan.planId,
    scopeToken: plan.scopeToken,
  });
}

test("a Content body paints in a cookie-less nested widget frame", async ({
  browser,
  baseURL,
  page,
}) => {
  if (!baseURL) throw new Error("Content Playwright baseURL is missing");

  const marker = `Nested widget body ${Date.now().toString(36)}`;
  const documentId = await createPage(
    page,
    `Nested widget body paint ${Date.now().toString(36)}`,
    `${marker} stays readable when the browser blocks storage access.`,
  );
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await postAction(page, "set-resource-visibility", {
      resourceType: "document",
      resourceId: documentId,
      visibility: "public",
    });

    context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    await context.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException(
              "Storage access is blocked",
              "SecurityError",
            );
          },
        });
      }
    });
    await context.route("https://chatgpt.com/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === "/widget-host"
          ? '<iframe id="widget-shell" sandbox="allow-scripts allow-same-origin allow-forms" src="/widget-shell"></iframe>'
          : path === "/widget-shell"
            ? `<iframe id="content-editor" sandbox="allow-scripts allow-same-origin allow-forms" src="${baseURL}/p/${documentId}"></iframe>`
            : "";
      await route.fulfill({
        status: path === "/widget-host" || path === "/widget-shell" ? 200 : 404,
        contentType: "text/html",
        body: `<!doctype html><html><body>${body}</body></html>`,
      });
    });

    const host = await context.newPage();
    await host.goto("https://chatgpt.com/widget-host");

    const contentEditor = host
      .frameLocator("#widget-shell")
      .frameLocator("#content-editor");
    await expect(
      contentEditor.locator(".notion-editor.ProseMirror"),
    ).toContainText(marker, { timeout: 60_000 });
    expect(await context.cookies()).toEqual([]);
    expect(
      await contentEditor.locator("body").evaluate((body) => {
        const frameWindow = body.ownerDocument.defaultView;
        if (!frameWindow) throw new Error("Content frame window is missing");
        return ["localStorage", "sessionStorage", "indexedDB"].map(
          (apiName) => {
            try {
              Reflect.get(frameWindow, apiName);
              return false;
            } catch (error) {
              return (
                error instanceof DOMException && error.name === "SecurityError"
              );
            }
          },
        );
      }),
    ).toEqual([true, true, true]);
  } finally {
    await context?.close();
    await removeDocument(page, documentId);
  }
});
