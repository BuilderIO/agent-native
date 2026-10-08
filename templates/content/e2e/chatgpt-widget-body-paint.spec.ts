import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildEmbedStartPath,
  COOKIE_NAME,
  createEmbedSessionTicket,
} from "@agent-native/core/server";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

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

async function captureWidgetFailure(
  testInfo: TestInfo,
  host: Page,
  shell: Locator,
  editor: Locator,
  actionResponses: Array<{ action: string; status: number }>,
) {
  const readText = async (locator: Locator) => {
    try {
      return await locator.innerText({ timeout: 1_500 });
    } catch {
      return "<frame body unavailable>";
    }
  };
  const [hostText, shellText, editorText] = await Promise.all([
    readText(host.locator("body")),
    readText(shell),
    readText(editor),
  ]);
  await testInfo.attach("nested-widget-frame-text.txt", {
    body: Buffer.from(
      [
        `host frame:\n${hostText}`,
        `widget shell frame:\n${shellText}`,
        `Content editor frame:\n${editorText}`,
        `action responses:\n${JSON.stringify(actionResponses, null, 2)}`,
      ].join("\n\n"),
    ),
    contentType: "text/plain",
  });
  await testInfo.attach("nested-widget-host.png", {
    body: await host.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("a Content body paints from a scoped ticket in a nested widget frame", async ({
  browser,
  baseURL,
  page,
}, testInfo) => {
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
      Object.defineProperty(window, "__e2eBlockedStorageReads", {
        configurable: true,
        value: [] as string[],
      });
      for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            (
              window as Window & { __e2eBlockedStorageReads: string[] }
            ).__e2eBlockedStorageReads.push(name);
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
    const actionResponses: Array<{ action: string; status: number }> = [];
    await context.route(widgetHostUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body style="margin:0;height:100vh"><iframe id="widget-shell" style="display:block;width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin allow-forms" src="${widgetShellUrl}"></iframe></body></html>`,
      });
    });
    await context.route(widgetShellUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body style="margin:0;height:100vh"><iframe id="content-editor" style="display:block;width:100%;height:100%;border:0" sandbox="allow-scripts allow-same-origin allow-forms" src="${embedStartUrl}"></iframe></body></html>`,
      });
    });

    const host = await context.newPage();
    host.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      const action = pathname.match(/\/_agent-native\/actions\/([^/]+)$/)?.[1];
      if (action) actionResponses.push({ action, status: response.status() });
    });
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
    const shellFrame = host.frameLocator("#widget-shell").locator("body");
    const editorBody = contentEditor.locator("body");
    try {
      await expect
        .poll(
          () => {
            const observed = new Set(
              actionResponses.map(({ action }) => action),
            );
            return [
              "get-document",
              "get-preview-document-draft",
              "list-comments",
              "list-resource-suggestions",
            ].every((action) => observed.has(action));
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      expect(
        actionResponses.filter(
          ({ action }) => action === "list-document-properties",
        ),
      ).toEqual([]);
      await expect(
        contentEditor.locator('[data-block-fields-state="solo"]'),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        contentEditor.locator(".notion-editor.ProseMirror"),
      ).toContainText(marker, { timeout: 10_000 });
    } catch (error) {
      await captureWidgetFailure(
        testInfo,
        host,
        shellFrame,
        editorBody,
        actionResponses,
      );
      throw error;
    }
    const cookies = await context.cookies(baseURL);
    expect(cookies.some(({ name }) => name === EMBED_SESSION_COOKIE)).toBe(
      true,
    );
    expect(cookies.some(({ name }) => name === COOKIE_NAME)).toBe(false);
    expect(
      await editorBody.evaluate((body) => {
        const frameWindow = body.ownerDocument.defaultView;
        if (!frameWindow) throw new Error("Content frame window is missing");
        const storageWindow = frameWindow as Window & {
          __e2eBlockedStorageReads: string[];
        };
        const memoryShimNames = ["localStorage", "sessionStorage"].filter(
          (name) => {
            const storage = Reflect.get(frameWindow, name) as
              | { getItem?: unknown }
              | undefined;
            return typeof storage?.getItem === "function";
          },
        );
        let indexedDbError: string | null = null;
        try {
          Reflect.get(frameWindow, "indexedDB");
        } catch (error) {
          indexedDbError =
            error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "Error";
        }
        return {
          blockedAtBoot: storageWindow.__e2eBlockedStorageReads,
          memoryShimNames,
          indexedDbError,
        };
      }),
    ).toEqual({
      blockedAtBoot: ["localStorage", "sessionStorage", "indexedDB"],
      memoryShimNames: ["localStorage", "sessionStorage"],
      indexedDbError: "SecurityError",
    });
  } finally {
    await context?.close();
    await removeDocument(page, documentId);
  }
});
