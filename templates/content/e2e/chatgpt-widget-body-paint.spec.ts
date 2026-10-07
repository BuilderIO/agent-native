import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildEmbedStartPath,
  COOKIE_NAME,
  createEmbedSessionTicket,
} from "@agent-native/core/server";
import { expect, test, type Page } from "@playwright/test";

import {
  createMcpDirectoryWidgetReadCapability,
  EMBED_SESSION_COOKIE,
} from "../../../packages/core/src/shared/embed-auth";
import { CHATGPT_DIRECTORY_PROFILE } from "../server/lib/chatgpt-directory-tools.js";
import { postAction } from "./helpers";

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

test("a Content body paints from a scoped ticket in a nested widget frame", async ({
  browser,
  baseURL,
  page,
}) => {
  if (!baseURL) throw new Error("Content Playwright baseURL is missing");

  const marker = `Nested widget body ${Date.now().toString(36)}`;
  const created = await postAction<{ id?: string; spaceId?: string }>(
    page,
    "create-document",
    {
      title: `Nested widget body paint ${Date.now().toString(36)}`,
      content: `${marker} stays readable when the browser blocks storage access.`,
    },
  );
  if (!created.id) throw new Error("create-document returned no id");
  const documentId = created.id;
  const resourceIds = {
    documentId,
    resourceType: "document",
    ...(created.spaceId ? { spaceId: created.spaceId } : {}),
  };
  const actionArguments: Record<
    string,
    Record<
      string,
      | string
      | { type: "integerRange"; min: number; max: number }
      | { type: "actionSchema" }
    >
  > = {};
  for (const [actionName, argumentMap] of Object.entries(
    CHATGPT_DIRECTORY_PROFILE.widgetReadActionArguments,
  )) {
    const scopedArguments: (typeof actionArguments)[string] = {};
    for (const [argumentName, rule] of Object.entries(argumentMap)) {
      if (typeof rule === "string") {
        const resourceId = resourceIds[rule as keyof typeof resourceIds];
        if (!resourceId) break;
        scopedArguments[argumentName] = resourceId;
      } else {
        scopedArguments[argumentName] = rule;
      }
    }
    if (
      Object.keys(scopedArguments).length === Object.keys(argumentMap).length
    ) {
      actionArguments[actionName] = scopedArguments;
    }
  }
  const scope = createMcpDirectoryWidgetReadCapability({
    appId: "content",
    resourceUri: "ui://content/shell-v67",
    resourceIds,
    actionArguments,
  });
  if (!scope) {
    throw new Error("Could not create a scoped Content widget capability");
  }
  const reviewerEmail = readFileSync(
    fileURLToPath(new URL("../.auth/email.txt", import.meta.url)),
    "utf8",
  ).trim();
  const ticket = await createEmbedSessionTicket({
    ownerEmail: reviewerEmail,
    targetPath: `/page/${encodeURIComponent(documentId)}`,
    scope,
  });
  const embedStartUrl = new URL(
    buildEmbedStartPath(ticket.ticket),
    baseURL,
  ).toString();
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
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
    const widgetHostUrl = new URL("/__e2e/widget-host", baseURL).toString();
    const widgetShellUrl = new URL("/__e2e/widget-shell", baseURL).toString();
    await context.route(widgetHostUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><iframe id="widget-shell" sandbox="allow-scripts allow-same-origin allow-forms" src="${widgetShellUrl}"></iframe></body></html>`,
      });
    });
    await context.route(widgetShellUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><iframe id="content-editor" sandbox="allow-scripts allow-same-origin allow-forms" src="${embedStartUrl}"></iframe></body></html>`,
      });
    });

    const host = await context.newPage();
    const editorResponse = host.waitForResponse((response) => {
      const request = response.request();
      return (
        request.isNavigationRequest() &&
        new URL(response.url()).pathname === `/page/${documentId}`
      );
    });
    await host.goto(widgetHostUrl);
    const response = await editorResponse;
    expect(response.status(), "the scoped editor frame must load").toBe(200);

    const contentEditor = host
      .frameLocator("#widget-shell")
      .frameLocator("#content-editor");
    await expect(
      contentEditor.locator(".notion-editor.ProseMirror"),
    ).toContainText(marker, { timeout: 60_000 });
    const cookies = await context.cookies(baseURL);
    expect(cookies.some(({ name }) => name === EMBED_SESSION_COOKIE)).toBe(
      true,
    );
    expect(cookies.some(({ name }) => name === COOKIE_NAME)).toBe(false);
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
