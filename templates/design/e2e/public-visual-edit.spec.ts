import http, { type Server } from "node:http";
import path from "node:path";

import { decodeContinuation } from "@agent-native/core/shared";
import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  bridgeMessages,
  designFrame,
  installBridge,
  readSeedDesignId,
} from "./helpers";

const AUTH_STATE_PATH = process.env.E2E_AUTH_DIR
  ? path.join(path.resolve(process.env.E2E_AUTH_DIR), "state.json")
  : path.join(import.meta.dirname, ".auth", "state.json");
const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SHORTCUT = process.platform === "darwin" ? "Meta+k" : "Control+k";

let designId: string;
let linkedScreenId: string;
let visualEditTargetServer: Server | null = null;
let visualEditBridge: DesignConnectBridge | null = null;
let visualEditTargetUrl = "";
const VISUAL_EDIT_BRIDGE_TOKEN = "signed-out-visual-edit-e2e-bridge-token";

type PageRuntimeErrors = {
  consoleErrors: string[];
  pageErrors: string[];
};

type SignedOutPage = PageRuntimeErrors & {
  page: Page;
  close: () => Promise<void>;
  mutationRequests: string[];
};

/** The design's own screen. `designFrame`'s `.last()` resolves to the linked
 *  screen this fixture mounts after it. */
function ownScreenFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
}

test.describe.serial("public visual edit", () => {
  test.beforeAll(async ({ browser }) => {
    visualEditTargetServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><body><main><h1>Local visual edit target</h1></main></body></html>",
      );
    });
    const address = await listen(visualEditTargetServer);
    visualEditTargetUrl = `http://${address.host}:${address.port}`;
    const bridgePortServer = http.createServer();
    const bridgeAddress = await listen(bridgePortServer);
    await closeServer(bridgePortServer);
    const manifest = await prepareDesignConnectManifest({
      root: path.resolve(import.meta.dirname, "fixtures"),
      url: visualEditTargetUrl,
      port: bridgeAddress.port,
    });
    visualEditBridge = await startDesignConnectBridge(manifest, {
      bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
      allowedOrigins: [new URL(BASE_URL).origin],
    });
    designId = await readSeedDesignId();
    linkedScreenId = await createLinkedScreen(browser, designId);
    await setDesignVisibility(browser, designId, "public");
  });

  test.afterAll(async ({ browser }) => {
    if (designId) {
      if (linkedScreenId) await deleteLinkedScreen(browser, linkedScreenId);
      await setDesignVisibility(browser, designId, "private");
    }
    await closeServer(visualEditBridge?.server ?? null);
    visualEditBridge = null;
    await closeServer(visualEditTargetServer);
    visualEditTargetServer = null;
  });

  test("loads the public /visual-edit route without a session and stays crash-free", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(browser, "/visual-edit");
    try {
      await expect(signedOut.page).toHaveURL(
        new RegExp(`${escapeRegExp(appUrl("/visual-edit"))}(?:[?#].*)?$`),
      );
      await expect(
        signedOut.page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("heading", {
          name: /start with \/visual-edit/i,
        }),
      ).toBeVisible();
      await expect(
        signedOut.page.getByText(
          "npx @agent-native/core@latest skills add visual-edit",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("button", { name: /^copy$/i }),
      ).toBeVisible();
      await assertNoRuntimeErrors(signedOut);

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.getByRole("dialog").filter({ visible: true }),
      ).toHaveCount(0);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("signed-out /visual-edit opens a capability-scoped editor through page WebMCP", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(browser, "/visual-edit");
    try {
      if (!visualEditBridge)
        throw new Error("visual-edit bridge is not running");
      const bridgeInput = {
        bridgeUrl: visualEditBridge.manifest.bridgeUrl,
        bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
        rootPath: visualEditBridge.manifest.rootPath,
      };
      await expect
        .poll(
          () =>
            signedOut.page.evaluate(() => {
              const status = (
                window as Window & {
                  __agentNativeWebMcpStatus?: {
                    state?: string;
                    registered?: number;
                    total?: number;
                    error?: string;
                  };
                }
              ).__agentNativeWebMcpStatus;
              return status ?? null;
            }),
          { timeout: 15_000 },
        )
        .toMatchObject({ state: "ready" });

      const preflightPromise = signedOut.page.evaluate(
        ({ devServerUrl, bridgeInput }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          return helper.call("open-visual-edit", {
            devServerUrl,
            paths: ["/"],
            navigate: false,
            ...bridgeInput,
          });
        },
        { devServerUrl: visualEditTargetUrl, bridgeInput },
      );

      const dialog = signedOut.page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await signedOut.page.screenshot({
        path: test.info().outputPath("signed-out-visual-edit-approval.png"),
      });
      await dialog.getByRole("button", { name: /open visual edit/i }).click();
      const preflight = await preflightPromise;
      if (!(preflight as { ok?: boolean }).ok) {
        throw new Error(
          `open-visual-edit preflight failed: ${JSON.stringify(preflight)}`,
        );
      }
      expect(preflight).toMatchObject({
        state: "done",
        ok: true,
        tool: "open-visual-edit",
      });

      const preflightResult = (
        preflight as { result?: Record<string, unknown> }
      ).result;
      expect(preflightResult?.designId).toEqual(expect.any(String));

      await signedOut.page.evaluate(
        ({ designId, devServerUrl, bridgeInput }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          void helper
            .call("open-visual-edit", {
              designId,
              devServerUrl,
              paths: ["/"],
              ...bridgeInput,
            })
            .catch(() => {
              // A successful call replaces this page while its evaluator is
              // still settling, so navigation can abort the promise normally.
            });
        },
        {
          designId: preflightResult?.designId,
          devServerUrl: visualEditTargetUrl,
          bridgeInput,
        },
      );

      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /open visual edit/i }).click();

      await signedOut.page.waitForURL(
        /\/visual-edit\/[^?]+\?.*__an_embed_token=/,
        { timeout: 30_000, waitUntil: "domcontentloaded" },
      );
      await expect(signedOut.page.locator("[data-design-editor]")).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(
          () =>
            signedOut.page.evaluate(async () => {
              const helper = (
                window as typeof window & {
                  __agentNativeWebMcp?: {
                    tools(): Promise<Array<{ name: string }>>;
                  };
                }
              ).__agentNativeWebMcp;
              if (!helper) throw new Error("WebMCP page helper missing");
              return (await helper.tools()).map((tool) => tool.name).sort();
            }),
          { timeout: 15_000 },
        )
        .toEqual(
          expect.arrayContaining([
            "get-visual-edit-prompt",
            "list-localhost-connections",
            "request-localhost-write-consent",
            "update-screen-source",
          ]),
        );

      await expect
        .poll(async () =>
          signedOut.page.evaluate(async () => {
            const helper = (
              window as typeof window & {
                __agentNativeWebMcp?: {
                  call(
                    name: string,
                    args?: Record<string, unknown>,
                  ): Promise<unknown>;
                };
              }
            ).__agentNativeWebMcp;
            if (!helper) throw new Error("WebMCP page helper missing");
            return helper.call("get-visual-edit-prompt", {});
          }),
        )
        .toMatchObject({
          state: "done",
          ok: true,
          tool: "get-visual-edit-prompt",
          result: { pendingEditCount: 0, status: "empty" },
        });

      const capabilityDesignId = new URL(signedOut.page.url()).pathname
        .split("/")
        .pop();
      expect(capabilityDesignId).toEqual(preflightResult?.designId);
      await expect
        .poll(async () =>
          signedOut.page.evaluate(async (designId) => {
            const helper = (
              window as typeof window & {
                __agentNativeWebMcp?: {
                  call(
                    name: string,
                    args?: Record<string, unknown>,
                  ): Promise<unknown>;
                };
              }
            ).__agentNativeWebMcp;
            if (!helper) throw new Error("WebMCP page helper missing");
            return helper.call("list-localhost-connections", { designId });
          }, capabilityDesignId),
        )
        .toMatchObject({
          state: "done",
          ok: true,
          tool: "list-localhost-connections",
          result: { count: 1 },
        });

      const direct = await openSignedOutPage(
        browser,
        `/visual-edit/${encodeURIComponent(String(preflightResult?.designId))}?editorView=overview`,
      );
      try {
        await expect(direct.page).toHaveURL(
          /\/visual-edit\/[^?]+\?.*__an_embed_token=/,
          { timeout: 30_000 },
        );
        await expect(direct.page.locator("[data-design-editor]")).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          direct.page.locator("[data-read-only-design-banner]"),
        ).toHaveCount(0);
        await expect(
          direct.page
            .locator("iframe[data-design-preview-iframe]")
            .last()
            .contentFrame()
            .getByRole("heading", { name: "Local visual edit" }),
        ).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(
            () =>
              direct.page.evaluate(async (designId) => {
                const helper = (
                  window as typeof window & {
                    __agentNativeWebMcp?: {
                      call(
                        name: string,
                        args?: Record<string, unknown>,
                      ): Promise<unknown>;
                    };
                  }
                ).__agentNativeWebMcp;
                if (!helper) throw new Error("WebMCP page helper missing");
                return helper.call("list-localhost-connections", { designId });
              }, preflightResult?.designId),
            { timeout: 15_000 },
          )
          .toMatchObject({
            state: "done",
            ok: true,
            result: { count: 1 },
          });
        await assertNoRuntimeErrors(direct);
      } finally {
        await direct.close();
      }

      const modeMarkerDirect = await openSignedOutPage(
        browser,
        `/visual-edit/${encodeURIComponent(String(preflightResult?.designId))}?editorView=overview&embedChrome=1&embedded=1`,
      );
      try {
        await expect(modeMarkerDirect.page).toHaveURL(
          /\/visual-edit\/[^?]+\?.*__an_embed_token=/,
          { timeout: 30_000 },
        );
        await expect(
          modeMarkerDirect.page.locator("[data-read-only-design-banner]"),
        ).toHaveCount(0);
        await expect(
          modeMarkerDirect.page.locator("[data-design-editor]"),
        ).toBeVisible({ timeout: 30_000 });
        await assertNoRuntimeErrors(modeMarkerDirect);
      } finally {
        await modeMarkerDirect.close();
      }

      const consentRequest = await signedOut.page.evaluate(
        async ({ designId, connectionId }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          return helper.call("request-localhost-write-consent", {
            designId,
            connectionId,
            files: ["src/App.tsx"],
          });
        },
        {
          designId: preflightResult?.designId,
          connectionId: preflightResult?.connectionId,
        },
      );
      expect(consentRequest).toMatchObject({
        state: "done",
        ok: true,
        tool: "request-localhost-write-consent",
        result: {
          designId: preflightResult?.designId,
          connectionId: preflightResult?.connectionId,
        },
      });

      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("authenticated public design links register WebMCP actions", async ({
    page,
  }) => {
    await page.goto(appUrl(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    const cdp = await page.context().newCDPSession(page);
    const readWebMcpState = async () => {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const modelContext = document.modelContext;
          const status = window.__agentNativeWebMcpStatus;
          const tools =
            modelContext && typeof modelContext.getTools === "function"
              ? await modelContext.getTools()
              : [];
          return {
            helper: Boolean(window.__agentNativeWebMcp),
            modelContext: Boolean(modelContext),
            status: status
              ? {
                  state: status.state,
                  registered: status.registered,
                  total: status.total,
                }
              : null,
            toolCount: tools.length,
            toolNames: tools.map((tool) => tool.name),
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.value as {
        helper: boolean;
        modelContext: boolean;
        status: {
          state: string;
          registered: number;
          total: number;
        } | null;
        toolCount: number;
        toolNames: string[];
      };
    };

    await expect.poll(readWebMcpState, { timeout: 15_000 }).toMatchObject({
      helper: true,
      modelContext: true,
      status: { state: "ready" },
      toolNames: expect.arrayContaining(["get-visual-edit-prompt"]),
    });
    expect((await readWebMcpState()).toolCount).toBeGreaterThan(0);
    const promptCall = await page.evaluate(async () => {
      const helper = (
        window as typeof window & {
          __agentNativeWebMcp?: {
            call: (
              name: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__agentNativeWebMcp;
      if (!helper) throw new Error("WebMCP page helper missing");
      return helper.call("get-visual-edit-prompt", {});
    });
    expect(promptCall).toMatchObject({
      state: "done",
      ok: true,
      tool: "get-visual-edit-prompt",
      result: {
        designId,
        pendingEditCount: 0,
        status: "empty",
      },
    });
  });

  test("public /design/:id renders read-only and stays crash-free", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(browser, `/design/${designId}`);
    try {
      await expect(
        ownScreenFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();
      const publicIframe = signedOut.page
        .locator("iframe[data-design-preview-iframe]")
        .last();
      await expect(publicIframe).toBeVisible();
      await publicIframe.evaluate((element) => {
        const frame = element as HTMLIFrameElement & {
          __publicReadOnlyLoadCount?: number;
        };
        frame.dataset.publicReadOnlyIdentity = "stable-public-preview";
        frame.__publicReadOnlyLoadCount = 0;
        frame.addEventListener("load", () => {
          frame.__publicReadOnlyLoadCount =
            (frame.__publicReadOnlyLoadCount ?? 0) + 1;
        });
      });
      await ownScreenFrame(signedOut.page)
        .locator("body")
        .evaluate(() => {
          (window as any).__publicReadOnlyDocumentMarker =
            "stable-public-document";
        });
      const expectStablePublicPreview = async () => {
        await expect
          .poll(async () => {
            const iframeState = await publicIframe.evaluate((element) => {
              const frame = element as HTMLIFrameElement & {
                __publicReadOnlyLoadCount?: number;
              };
              const style = getComputedStyle(frame);
              const rect = frame.getBoundingClientRect();
              return {
                identity: frame.dataset.publicReadOnlyIdentity ?? null,
                loads: frame.__publicReadOnlyLoadCount ?? -1,
                visible:
                  frame.isConnected &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  Number(style.opacity) !== 0 &&
                  rect.width > 0 &&
                  rect.height > 0,
              };
            });
            const documentMarker = await ownScreenFrame(signedOut.page)
              .locator("body")
              .evaluate(
                () => (window as any).__publicReadOnlyDocumentMarker ?? null,
              )
              .catch(() => null);
            return { ...iframeState, documentMarker };
          })
          .toEqual({
            identity: "stable-public-preview",
            documentMarker: "stable-public-document",
            loads: 0,
            visible: true,
          });
      };
      // Button asChild wraps an <a href>, so the CTA's role is link — the
      // sibling /visual-edit test queries it the same way.
      await expect(
        signedOut.page.getByRole("link", { name: /^sign up$/i }).first(),
      ).toBeVisible();
      // A read-only visitor DOES get a Share control — it is a sign-in CTA
      // rendered as `<Button asChild><a>`, so it carries role "link", not
      // "button". Asserting no *button* named share passed for the wrong
      // reason: it is vacuously true whether or not the control renders.
      // `signed-out save and share buttons send visitors to the sign-in
      // return URL` covers where that link goes.
      await expect(
        signedOut.page.getByRole("link", { name: /^share$/i }),
      ).toHaveCount(1);

      signedOut.mutationRequests.length = 0;
      await installBridge(signedOut.page);
      await signedOut.page.evaluate(() => {
        (window as any).__bridge = [];
      });
      const heading = ownScreenFrame(signedOut.page)
        .getByText("E2E Hero Heading")
        .first();
      const headingBox = await heading.boundingBox();
      expect(headingBox).toBeTruthy();
      await signedOut.page.mouse.click(
        (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
        (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
      );
      await signedOut.page.keyboard.type("read-only check");
      await signedOut.page.waitForTimeout(400);

      expect(signedOut.mutationRequests).toEqual([]);
      await expect
        .poll(async () =>
          (await bridgeMessages(signedOut.page)).some((message) =>
            /^(visual-style-change|visual-structure-change|visual-duplicate-change|text-content-change)$/.test(
              String(message?.type ?? ""),
            ),
          ),
        )
        .toBe(false);
      await expect(
        ownScreenFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();
      await expectStablePublicPreview();

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.getByRole("dialog").filter({ visible: true }),
      ).toHaveCount(0);
      await expectStablePublicPreview();
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("public design links restore the requested overview screen", async ({
    browser,
  }) => {
    const pathname = `/design/${designId}?view=overview&screen=${linkedScreenId}&zoom=60`;
    const signedOut = await openSignedOutPage(browser, pathname);
    try {
      await expect(
        designFrame(signedOut.page, linkedScreenId).getByText(
          "Linked public screen",
        ),
      ).toBeVisible();
      await expect(signedOut.page).toHaveURL(
        new RegExp(`screen=${escapeRegExp(linkedScreenId)}`),
      );
      expect(signedOut.mutationRequests).toEqual([]);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("signed-out save and share buttons send visitors to the sign-in return URL", async ({
    browser,
  }) => {
    // Both signed-out CTAs are `<Button asChild><a href=...>`, so the element
    // that carries the accessible name is an anchor with role "link".
    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) =>
        page
          .getByRole("link")
          .filter({ hasText: /^sign up$/i })
          .first(),
      appReturnPath(`/design/${designId}?intent=save`),
    );

    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) => page.getByRole("link", { name: /^share$/i }).first(),
      appReturnPath(`/design/${designId}?intent=share`),
    );
  });
});

async function listen(server: Server): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("Visual-edit target server did not bind."));
        return;
      }
      resolve({ host: address.address, port: address.port });
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function setDesignVisibility(
  browser: Browser,
  id: string,
  visibility: "public" | "private",
): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/set-resource-visibility`,
      {
        data: {
          resourceType: "design",
          resourceId: id,
          visibility,
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `set-resource-visibility(${visibility}) failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      visibility?: string;
      ok?: boolean;
    };
    expect(body.visibility ?? visibility).toBe(visibility);
  } finally {
    await context.close();
  }
}

async function createLinkedScreen(browser: Browser, designId: string) {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/create-file`,
      {
        data: {
          designId,
          filename: "linked-public-screen.html",
          fileType: "html",
          content:
            "<!doctype html><html><body><h1>Linked public screen</h1></body></html>",
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `create-file failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error("create-file returned no file ID");
    return body.id;
  } finally {
    await context.close();
  }
}

async function deleteLinkedScreen(browser: Browser, fileId: string) {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/delete-file`,
      { data: { id: fileId } },
    );
    if (!response.ok()) {
      throw new Error(
        `delete-file failed: ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await context.close();
  }
}

async function openSignedOutPage(
  browser: Browser,
  pathname: string,
): Promise<SignedOutPage> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const mutationRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "POST" && /\/_agent-native\/actions\//.test(url)) {
      mutationRequests.push(url);
    }
  });

  await page.goto(appUrl(pathname), {
    waitUntil: "domcontentloaded",
  });

  return {
    page,
    consoleErrors,
    pageErrors,
    mutationRequests,
    close: async () => {
      await context.close();
    },
  };
}

async function expectReturnUrl(
  browser: Browser,
  pathname: string,
  getButton: (page: Page) => Locator,
  expectedReturnPath: string,
): Promise<void> {
  const signedOut = await openSignedOutPage(browser, pathname);
  try {
    const button = getButton(signedOut.page);
    await expect(button).toBeVisible();
    await button.click();
    await expect(signedOut.page).toHaveURL(/\/sign-in\?c=/);

    const url = new URL(signedOut.page.url());
    const continuation = url.searchParams.get("c");
    expect(continuation).toBeTruthy();
    expect(decodeContinuation(continuation)).toBe(expectedReturnPath);
    await assertNoRuntimeErrors(signedOut);
  } finally {
    await signedOut.close();
  }
}

async function assertNoRuntimeErrors({
  consoleErrors,
  pageErrors,
}: PageRuntimeErrors): Promise<void> {
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !message.includes("401 (Unauthorized)"),
  );
  expect(
    unexpectedConsoleErrors,
    `console errors: ${unexpectedConsoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appUrl(pathname: string): string {
  return new URL(appPath(pathname), BASE_URL).toString();
}

function appReturnPath(pathname: string): string {
  const url = new URL(appUrl(pathname));
  return `${url.pathname}${url.search}${url.hash}`;
}
