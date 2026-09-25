import { mkdir } from "node:fs/promises";
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
  enterDirectMode,
  installBridge,
  readSeedDesignId,
  selectByText,
  waitForBridge,
} from "./helpers";

const AUTH_STATE_PATH = process.env.E2E_AUTH_DIR
  ? path.join(path.resolve(process.env.E2E_AUTH_DIR), "state.json")
  : path.join(import.meta.dirname, ".auth", "state.json");
const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SHORTCUT = process.platform === "darwin" ? "Meta+k" : "Control+k";
const UNDO_SHORTCUT = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO_SHORTCUT =
  process.platform === "darwin" ? "Meta+Shift+z" : "Control+y";

let designId: string;
let linkedScreenId: string;
let collaborationDesignId: string;
let collaborationScreenId: string;
let collaborationSecondScreenId: string;
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
    visualEditTargetServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;
      if (pathname === "/slow") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          `<!doctype html><html><body><main><h1>Delayed image frame</h1><img id="delayed-image" src="${visualEditTargetUrl}/slow-image.svg" /></main></body></html>`,
        );
        return;
      }
      if (pathname === "/slow-image.svg") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "image/svg+xml",
        });
        setTimeout(() => {
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="36" fill="#7c3aed"/></svg>',
          );
        }, 5_000);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body><main><h1>${requestUrl.searchParams.has("e2eRoute") ? "Owner updated canvas" : "Local visual edit"}</h1></main></body></html>`,
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
    const collaborationDesign = await createOwnedVisualEditDesign(browser);
    collaborationDesignId = collaborationDesign.designId;
    collaborationScreenId = collaborationDesign.screenIds[0]!;
    collaborationSecondScreenId = collaborationDesign.screenIds[1]!;
    await setDesignVisibility(browser, collaborationDesignId, "public");
  });

  test.afterAll(async ({ browser }) => {
    if (designId) {
      if (linkedScreenId) await deleteLinkedScreen(browser, linkedScreenId);
      await setDesignVisibility(browser, designId, "private");
    }
    if (collaborationDesignId) {
      await deleteDesign(browser, collaborationDesignId);
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

  test("reveals the local frame as soon as its editor bridge is ready", async ({
    page,
  }) => {
    let createdDesignId: string | undefined;
    await page.addInitScript(() => {
      if (window.top !== window) return;
      const timing = {
        mountedAt: null as number | null,
        readyAt: null as number | null,
        loadAt: null as number | null,
      };
      Object.defineProperty(window, "__visualEditFrameTiming", {
        configurable: false,
        value: timing,
      });
      const mountTimes = new WeakMap<HTMLIFrameElement, number>();
      const watchedFrames = new WeakSet<HTMLIFrameElement>();
      const watchFrame = (element: Element) => {
        if (
          !(element instanceof HTMLIFrameElement) ||
          !element.matches("iframe[data-design-preview-iframe]") ||
          watchedFrames.has(element)
        ) {
          return;
        }
        watchedFrames.add(element);
        mountTimes.set(element, performance.now());
        element.addEventListener("load", () => {
          if (element.src.includes("slow")) timing.loadAt ??= performance.now();
        });
      };
      const scan = (node: Node) => {
        if (!(node instanceof Element)) return;
        watchFrame(node);
        node
          .querySelectorAll("iframe[data-design-preview-iframe]")
          .forEach(watchFrame);
      };
      new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach(scan);
          if (
            record.type === "attributes" &&
            record.target instanceof HTMLIFrameElement
          ) {
            watchFrame(record.target);
          }
        }
      }).observe(document, {
        attributes: true,
        attributeFilter: ["src"],
        childList: true,
        subtree: true,
      });
      window.addEventListener("message", (event) => {
        if (
          event.data?.type !== "agent-native:editor-chrome-ready" ||
          timing.readyAt !== null
        ) {
          return;
        }
        const frame = [
          ...document.querySelectorAll<HTMLIFrameElement>(
            'iframe[data-design-preview-iframe][src*="slow"]',
          ),
        ].find((candidate) => candidate.contentWindow === event.source);
        if (!frame) return;
        timing.mountedAt = mountTimes.get(frame) ?? performance.now();
        timing.readyAt = performance.now();
      });
    });

    const openedResponse = await page.request.post(
      appPath("/_agent-native/actions/open-visual-edit"),
      {
        data: {
          title: "Iframe load timing",
          devServerUrl: visualEditTargetUrl,
          bridgeUrl: visualEditBridge!.manifest.bridgeUrl,
          bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
          rootPath: visualEditBridge!.manifest.rootPath,
          paths: ["/slow"],
          navigate: false,
        },
      },
    );
    expect(openedResponse.ok()).toBe(true);
    const opened = (await openedResponse.json()) as {
      designId?: string;
      urlPath?: string;
    };
    createdDesignId = opened.designId;
    if (!createdDesignId) throw new Error("open-visual-edit returned no ID");
    if (!opened.urlPath) throw new Error("open-visual-edit returned no URL");

    try {
      await page.goto(
        `${BASE_URL}${opened.urlPath}&editorView=overview&zoom=50`,
        { waitUntil: "domcontentloaded" },
      );
      const editorFrame = page.locator(
        'iframe[data-design-preview-iframe][src*="live-edit"][src*="slow"]',
      );
      await expect(editorFrame).toBeAttached({ timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const timing = (
            window as Window & {
              __visualEditFrameTiming?: { readyAt: number | null };
            }
          ).__visualEditFrameTiming;
          return typeof timing?.readyAt === "number";
        },
        undefined,
        { timeout: 30_000 },
      );

      const localScreen = editorFrame.contentFrame();
      await expect(
        localScreen.getByRole("heading", { name: "Delayed image frame" }),
      ).toBeVisible();
      expect(
        await localScreen
          .locator("#delayed-image")
          .evaluate((image) => !(image as HTMLImageElement).complete),
      ).toBe(true);
      await expect(page.getByText(/prepar.*live editor/i)).toBeHidden();

      const screenshotPath = path.resolve(
        import.meta.dirname,
        "../../../.tmp/visual-edit-iframe-ready.png",
      );
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath });
      await page.waitForFunction(
        () => {
          const timing = (
            window as Window & {
              __visualEditFrameTiming?: { loadAt: number | null };
            }
          ).__visualEditFrameTiming;
          return typeof timing?.loadAt === "number";
        },
        undefined,
        { timeout: 15_000 },
      );
      const timing = await page.evaluate(() => {
        const timing = (
          window as Window & {
            __visualEditFrameTiming?: {
              mountedAt: number | null;
              readyAt: number | null;
              loadAt: number | null;
            };
          }
        ).__visualEditFrameTiming;
        if (
          !timing ||
          timing.mountedAt === null ||
          timing.readyAt === null ||
          timing.loadAt === null
        ) {
          throw new Error("iframe timing events were not all observed");
        }
        return {
          bridgeReadyMs: Math.round(timing.readyAt - timing.mountedAt),
          fullLoadAfterReadyMs: Math.round(timing.loadAt - timing.readyAt),
        };
      });
      console.info(
        `[visual-edit-iframe-timing] bridge-ready=${timing.bridgeReadyMs}ms full-load-after-ready=${timing.fullLoadAfterReadyMs}ms`,
      );
    } finally {
      await page.request.post(appPath("/_agent-native/actions/delete-design"), {
        data: { id: createdDesignId },
      });
    }
  });

  test("rejects forged bare-link editor access", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: {
        "X-Agent-Native-Frontend": "1",
        Origin: new URL(BASE_URL).origin,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    try {
      const directResponse = await context.request.get(
        appUrl(`/visual-edit/${designId}`),
      );
      expect(directResponse.ok()).toBe(true);
      expect(directResponse.url()).toBe(appUrl(`/visual-edit/${designId}`));
      const directHtml = await directResponse.text();
      expect(directHtml).not.toContain("/_agent-native/embed/start");
      expect(directHtml).not.toMatch(/__an_embed_token=[^&"<]*/);

      const response = await context.request.post(
        appUrl("/_agent-native/actions/issue-visual-edit-access"),
        { data: { designId } },
      );
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain("/_agent-native/embed/start");

      const forgedFileWrite = await context.request.post(
        appUrl("/_agent-native/actions/update-file"),
        {
          data: {
            id: linkedScreenId,
            content: "forged anonymous source write",
          },
        },
      );
      expect([401, 403]).toContain(forgedFileWrite.status());

      const forgedDesignWrite = await context.request.post(
        appUrl("/_agent-native/actions/update-design"),
        {
          data: {
            id: designId,
            data: JSON.stringify({ title: "forged anonymous design write" }),
          },
        },
      );
      expect([401, 403]).toContain(forgedDesignWrite.status());
    } finally {
      await context.close();
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
          new RegExp(
            `${escapeRegExp(appUrl(`/visual-edit/${preflightResult?.designId}`))}\\?editorView=overview$`,
          ),
          { timeout: 30_000 },
        );
        expect(
          new URL(direct.page.url()).searchParams.get("__an_embed_token"),
        ).toBeNull();
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
        await installBridge(direct.page);
        const selected = await selectByText(direct.page, "Local visual edit");
        expect(selected.textContent).toBe("Local visual edit");
        const frame = direct.page
          .locator("iframe[data-design-preview-iframe]")
          .last()
          .contentFrame();
        const heading = frame.getByRole("heading", {
          name: "Local visual edit",
        });
        const before = await heading.boundingBox();
        expect(before).toBeTruthy();
        const handle = frame.locator('[data-agent-native-edge-handle="s"]');
        await expect(handle).toBeVisible({ timeout: 15_000 });
        const handleBox = await handle.boundingBox();
        expect(handleBox).toBeTruthy();
        await direct.page.evaluate(() => {
          (window as any).__bridge = [];
        });
        await direct.page.mouse.move(
          (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
          (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
        );
        await direct.page.mouse.down();
        await direct.page.mouse.move(
          (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
          (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2 + 16,
          { steps: 8 },
        );
        await direct.page.mouse.up();
        await waitForBridge(direct.page, "visual-style-change");
        await expect
          .poll(async () => (await heading.boundingBox())?.height ?? 0)
          .toBeGreaterThan((before?.height ?? 0) + 1);
        await expect
          .poll(
            () =>
              direct.page.evaluate(async () => {
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
            { timeout: 15_000 },
          )
          .toMatchObject({
            state: "done",
            ok: true,
            result: { pendingEditCount: expect.any(Number) },
          });
        const pendingAfterResize = await direct.page.evaluate(async () => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<any>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          return helper.call("get-visual-edit-prompt", {});
        });
        expect(pendingAfterResize.result.pendingEditCount).toBeGreaterThan(0);

        await direct.page.keyboard.press(UNDO_SHORTCUT);
        await expect
          .poll(async () => (await heading.boundingBox())?.height ?? 0)
          .toBeCloseTo(before?.height ?? 0, 0);
        await direct.page.keyboard.press(REDO_SHORTCUT);
        await expect
          .poll(async () => (await heading.boundingBox())?.height ?? 0)
          .toBeGreaterThan((before?.height ?? 0) + 1);
        expect(direct.mutationRequests).toEqual([]);
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
          /\/visual-edit\/[^?]+\?editorView=overview&embedChrome=1&embedded=1$/,
          { timeout: 30_000 },
        );
        await expect(
          modeMarkerDirect.page.locator("[data-read-only-design-banner]"),
        ).toHaveCount(0);
        await expect(
          modeMarkerDirect.page.locator("[data-design-editor]"),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          modeMarkerDirect.page.getByText("Preparing editable preview...", {
            exact: true,
          }),
        ).toHaveCount(0, { timeout: 30_000 });
        await expect(
          modeMarkerDirect.page
            .locator("iframe[data-design-preview-iframe]")
            .first()
            .contentFrame()
            .locator("[data-agent-native-editor-chrome-host]"),
        ).toHaveCount(1, { timeout: 30_000 });
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

  test("signed-out live canvas sharing requires sign-in and returns to the canvas", async ({
    browser,
  }) => {
    await expectReturnUrl(
      browser,
      `/visual-edit/${collaborationDesignId}?editorView=overview`,
      (page) =>
        page.getByRole("link", {
          name: "Sign up to share a live canvas",
        }),
      appReturnPath(`/visual-edit/${collaborationDesignId}?intent=share`),
    );
  });

  test("live collaboration can be enabled from Share by a signed-in editor", async ({
    browser,
    page,
  }) => {
    await setLiveCollaboration(browser, collaborationDesignId, false);
    try {
      await page.goto(
        appUrl(`/visual-edit/${collaborationDesignId}?editorView=overview`),
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.locator("[data-design-editor]")).toBeVisible();
      await page
        .getByRole("button", { name: /^share(?: \\(.+\\))?$/i })
        .first()
        .click();
      await page.getByRole("tab", { name: "Live collaboration" }).click();

      const collaborationToggle = page.getByRole("switch", {
        name: "Live collaboration",
      });
      await expect(collaborationToggle).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await collaborationToggle.click();
      await expect(collaborationToggle).toHaveAttribute("aria-checked", "true");
    } finally {
      await setLiveCollaboration(browser, collaborationDesignId, false);
    }
  });

  test("shares an inert live snapshot and hands guest edits back to the owner", async ({
    browser,
    page,
  }) => {
    await setLiveCollaboration(browser, collaborationDesignId, true);
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(BASE_URL).origin,
      permissions: ["localNetworkAccess"],
    });
    const ownerSnapshotStatuses: number[] = [];
    let ownerSnapshotPublished = false;
    page.on("response", (response) => {
      if (response.url().includes("/publish-visual-edit-snapshot")) {
        ownerSnapshotStatuses.push(response.status());
        void response
          .json()
          .then((body: { published?: boolean }) => {
            ownerSnapshotPublished ||= body.published === true;
          })
          .catch(() => {});
      }
    });
    await page.goto(
      appUrl(`/visual-edit/${collaborationDesignId}?editorView=overview`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const ownerFrame = designFrame(page, collaborationScreenId);
    await expect(
      ownerFrame.getByRole("heading", { name: "Local visual edit" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => ownerSnapshotPublished).toBe(true);

    await page.getByRole("button", { name: /^share$/i }).click();
    await expect(
      page.getByText("Live canvas link", { exact: true }),
    ).toBeVisible();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`/visual-edit/${collaborationDesignId}?share=1`);
    await page.keyboard.press("Escape");

    await expectReturnUrl(
      browser,
      `/design/${collaborationDesignId}`,
      (signedOutPage) =>
        signedOutPage.getByRole("link", {
          name: /^sign up to share a live canvas$/i,
        }),
      appReturnPath(`/design/${collaborationDesignId}?intent=share`),
    );

    const guestSnapshotReads: string[] = [];
    const guestSnapshotRequestCounts = new Map<string, number>();
    const guest = await openSignedOutPage(
      browser,
      `/visual-edit/${collaborationDesignId}?share=1&editorView=overview`,
      (guestPage) => {
        guestPage.on("request", (request) => {
          const url = new URL(request.url());
          if (!url.pathname.endsWith("/get-visual-edit-snapshot")) return;
          const fileId = url.searchParams.get("fileId");
          if (fileId) {
            guestSnapshotRequestCounts.set(
              fileId,
              (guestSnapshotRequestCounts.get(fileId) ?? 0) + 1,
            );
          }
        });
        guestPage.on("response", async (response) => {
          if (response.url().includes("/get-visual-edit-snapshot")) {
            guestSnapshotReads.push(
              `${response.status()}: ${await response.text()}`,
            );
          }
        });
      },
    );
    try {
      const guestFrame = designFrame(guest.page, collaborationScreenId);
      await expect
        .poll(() => guestSnapshotReads, { timeout: 15_000 })
        .toEqual(
          expect.arrayContaining([
            expect.stringContaining("Local visual edit"),
          ]),
        );
      await expect(
        guestFrame.getByRole("heading", { name: "Local visual edit" }),
      ).toBeVisible({ timeout: 30_000 });
      const secondGuestFrame = designFrame(
        guest.page,
        collaborationSecondScreenId,
      );
      await expect(
        secondGuestFrame.getByRole("heading", { name: "Local visual edit" }),
      ).toBeVisible({ timeout: 30_000 });
      const guestIframe = guest.page.locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${collaborationScreenId}"]`,
      );
      await expect(guestIframe).not.toHaveAttribute(
        "src",
        new RegExp(escapeRegExp(visualEditTargetUrl)),
      );
      await expect(guestIframe).toHaveAttribute("srcdoc", /Local visual edit/);

      const firstScreenInitialReads =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      await selectByText(guest.page, "Local visual edit", {
        screenId: collaborationScreenId,
      });
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenInitialReads);
      const firstScreenReads =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      const secondScreenReads =
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0;
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenReads);
      expect(
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0,
      ).toBe(secondScreenReads);

      await selectByText(guest.page, "Local visual edit", {
        screenId: collaborationSecondScreenId,
      });
      await expect
        .poll(
          () =>
            (guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0) >
            secondScreenReads,
        )
        .toBe(true);
      const firstScreenReadsAfterSwitch =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      const secondScreenReadsAfterSwitch =
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0;
      await expect
        .poll(
          () =>
            guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(secondScreenReadsAfterSwitch);
      expect(guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0).toBe(
        firstScreenReadsAfterSwitch,
      );

      const firstScreenReadsBeforeRefocus =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      await selectByText(guest.page, "Local visual edit", {
        screenId: collaborationScreenId,
      });
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenReadsBeforeRefocus);

      const ownerPublicationsBeforeEdit = ownerSnapshotStatuses.filter(
        (status) => status === 200,
      ).length;
      await page.evaluate(() => {
        const state = { messages: [] as string[] };
        Object.defineProperty(window, "__visualEditCollabMessages", {
          configurable: true,
          value: state,
        });
        window.addEventListener("message", (event) => {
          if (typeof event.data?.type === "string") {
            state.messages.push(event.data.type);
          }
        });
      });
      await ownerFrame.locator("h1").evaluate(() => {
        const route = new URL(window.location.href);
        route.searchParams.set("e2eRoute", "account");
        window.history.pushState({}, "", route);
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __visualEditCollabMessages?: { messages: string[] };
                }
              ).__visualEditCollabMessages?.messages ?? [],
          ),
        )
        .toContain("agent-native:live-route-path");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __visualEditCollabMessages?: { messages: string[] };
                }
              ).__visualEditCollabMessages?.messages ?? [],
          ),
        )
        .toContain("agent-native:runtime-layer-snapshot");
      await expect
        .poll(
          () => ownerSnapshotStatuses.filter((status) => status === 200).length,
        )
        .toBeGreaterThan(ownerPublicationsBeforeEdit);
      await expect(
        guestFrame.getByRole("heading", { name: "Owner updated canvas" }),
      ).toBeVisible({ timeout: 20_000 });

      const publicationStatuses: number[] = [];
      guest.page.on("response", (response) => {
        if (response.url().includes("/publish-visual-edit-pending")) {
          publicationStatuses.push(response.status());
        }
      });
      await enterDirectMode(guest.page, { screenId: collaborationScreenId });
      await installBridge(guest.page);
      const heading = guestFrame.getByRole("heading", {
        name: "Owner updated canvas",
      });
      const headingBox = await heading.boundingBox();
      expect(headingBox).toBeTruthy();
      await guest.page.evaluate(() => ((window as any).__bridge = []));
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await guest.page.keyboard.down(modifier);
      try {
        await guest.page.mouse.click(
          (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
          (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
        );
      } finally {
        await guest.page.keyboard.up(modifier);
      }
      const selection = await waitForBridge(guest.page, "element-select");
      const selected = selection?.payload ?? selection;
      expect(selected.textContent).toContain("Owner updated canvas");
      const before = await heading.boundingBox();
      expect(before).toBeTruthy();
      const handle = guestFrame.locator('[data-agent-native-edge-handle="s"]');
      await expect(handle).toBeVisible({ timeout: 15_000 });
      const handleBox = await handle.boundingBox();
      expect(handleBox).toBeTruthy();
      await guest.page.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
      );
      await guest.page.mouse.down();
      await guest.page.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2 + 16,
        { steps: 8 },
      );
      await guest.page.mouse.up();
      await waitForBridge(guest.page, "visual-style-change");
      await expect
        .poll(() => publicationStatuses.some((status) => status === 200))
        .toBe(true);
      await expect(
        page.getByRole("button", { name: "Apply edits", exact: true }),
      ).toBeVisible({ timeout: 20_000 });

      await page.screenshot({
        path: path.resolve(
          import.meta.dirname,
          "../../../.tmp/visual-edit-collaboration-owner.png",
        ),
      });
      await guest.page.screenshot({
        path: path.resolve(
          import.meta.dirname,
          "../../../.tmp/visual-edit-collaboration-guest.png",
        ),
      });
      await assertNoRuntimeErrors(guest);
    } finally {
      await guest.close();
    }
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

async function setLiveCollaboration(
  browser: Browser,
  designId: string,
  enabled: boolean,
): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      appUrl("/_agent-native/actions/update-visual-edit-collaboration"),
      { data: { designId, enabled } },
    );
    if (!response.ok()) {
      throw new Error(
        `update-visual-edit-collaboration(${enabled}) failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      designId?: string;
      enabled?: boolean;
    };
    expect(body).toMatchObject({ designId, enabled });
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

async function createOwnedVisualEditDesign(
  browser: Browser,
): Promise<{ designId: string; screenIds: string[] }> {
  if (!visualEditBridge) throw new Error("visual-edit bridge is not running");
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      appUrl("/_agent-native/actions/open-visual-edit"),
      {
        data: {
          title: "E2E live canvas collaboration",
          devServerUrl: visualEditTargetUrl,
          bridgeUrl: visualEditBridge.manifest.bridgeUrl,
          rootPath: visualEditBridge.manifest.rootPath,
          routeManifest: visualEditBridge.manifest,
          bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
          paths: ["/", "/settings"],
          navigate: false,
          publicReadOnly: false,
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `open-visual-edit failed: ${response.status()} ${await response.text()}`,
      );
    }
    const result = (await response.json()) as {
      designId?: string;
      screens?: Array<{ id?: string }>;
    };
    const designId = result.designId;
    const screenIds = result.screens?.flatMap((screen) =>
      screen.id ? [screen.id] : [],
    );
    if (!designId || !screenIds || screenIds.length < 2) {
      throw new Error("open-visual-edit returned no design or screen");
    }
    return { designId, screenIds };
  } finally {
    await context.close();
  }
}

async function deleteDesign(browser: Browser, id: string): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      appUrl("/_agent-native/actions/delete-design"),
      { data: { id } },
    );
    if (!response.ok()) {
      throw new Error(
        `delete-design failed: ${response.status()} ${await response.text()}`,
      );
    }
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
  beforeLoad?: (page: Page) => void,
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
  beforeLoad?.(page);

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
