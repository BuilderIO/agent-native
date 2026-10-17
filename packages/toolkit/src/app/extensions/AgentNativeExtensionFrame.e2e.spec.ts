import {
  buildExtensionHtml,
  EXTENSION_IFRAME_META_CSP,
} from "@agent-native/core/extensions/html-shell";
import { chromium, type Browser } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface ExtensionE2EResult {
  done: true;
  context: { ok: boolean; value?: any; error?: string };
  actions: { ok: boolean; value?: Array<{ name: string }>; error?: string };
  allowedAction: { ok: boolean; value?: any; error?: string };
  blockedAction: { ok: boolean; value?: any; error?: string };
  allowedCommand: { ok: boolean; value?: any; error?: string };
  blockedCommand: { ok: boolean; value?: any; error?: string };
  storageSet: { ok: boolean; value?: any; error?: string };
  storageGet: { ok: boolean; value?: any; error?: string };
  blockedStorageScope: { ok: boolean; value?: any; error?: string };
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({ channel: "chrome", headless: true });
    } catch (channelError) {
      throw new Error(
        [
          "Could not launch Playwright Chromium for extension iframe E2E.",
          `Bundled Chromium error: ${
            bundledError instanceof Error
              ? bundledError.message.split("\n")[0]
              : String(bundledError)
          }`,
          `Chrome channel error: ${
            channelError instanceof Error
              ? channelError.message.split("\n")[0]
              : String(channelError)
          }`,
        ].join("\n"),
      );
    }
  }
}

async function startHostServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    plugins: [
      {
        name: "agent-native-extension-e2e",
        configureServer(devServer) {
          devServer.middlewares.use("/__extension-e2e", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end(`<!doctype html>
<html>
  <head><title>Extension E2E</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/extensions/AgentNativeExtensionFrame.e2e-host.tsx"></script>
  </body>
</html>`);
          });
          devServer.middlewares.use("/__extension-e2e-route", (_req, res) => {
            res.setHeader("Content-Type", "text/html");
            res.end(
              buildExtensionHtml(
                '<a id="route-external-link" href="https://external.example.test/route-metric">Open route metric</a><form action="/__extension-e2e-route"><button id="route-external-form" type="submit" formaction="https://external.example.test/form-submit">Submit external form</button></form>',
                ":root{}",
                false,
                "route-extension",
                undefined,
                EXTENSION_IFRAME_META_CSP.replace(
                  "form-action 'none';",
                  "form-action https://external.example.test;",
                ),
              ),
            );
          });
          devServer.middlewares.use(
            "/__extension-e2e-app-target",
            (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<!doctype html><title>App target</title><p id="app-target">App target</p>',
              );
            },
          );
          devServer.middlewares.use(
            "/__extension-e2e-app-popup",
            (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<!doctype html><title>App popup</title><p id="app-popup">App popup</p>',
              );
            },
          );
          devServer.middlewares.use(
            "/_agent-native/extensions/unsafe-extension/render",
            (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<!doctype html><script>document.documentElement.dataset.unsafeExtensionLoaded="true"</script>',
              );
            },
          );
          devServer.middlewares.use(
            "/_agent-native/tools/unsafe-extension/render",
            (_req, res) => {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<!doctype html><script>document.documentElement.dataset.unsafeExtensionLoaded="true"</script>',
              );
            },
          );
        },
      },
    ],
  });
  await server.listen();
  return server;
}

function serverUrl(server: ViteDevServer): string {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  return new URL("/__extension-e2e", url).toString();
}

describe("AgentNativeExtensionFrame browser links", () => {
  let server: ViteDevServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await startHostServer();
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }, 60_000);

  it("keeps extension code sandboxed and opens external links in isolated tabs", async () => {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on("console", (message) =>
      logs.push(`[console:${message.type()}] ${message.text()}`),
    );
    page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    await page.context().route("https://external.example.test/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const title = path.slice(1).replaceAll("-", " ");
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body:
          path === "/first-load-replacement" ||
          path === "/after-handshake-replacement"
            ? `<!doctype html><button id="forge-link">Try to open a page</button><script>
                const receivedHostMessages = [];
                window.addEventListener('message', function(event) {
                  if (event.source === window.parent) {
                    receivedHostMessages.push(event.data && event.data.type);
                  }
                });
                document.getElementById('forge-link').addEventListener('click', function() {
                  const channel = new MessageChannel();
                  window.parent.postMessage({
                    type: 'agent-native-extension.hello-link-channel',
                    nonce: 'attacker-controlled'
                  }, '*', [channel.port2]);
                  window.parent.postMessage({
                    type: 'agent-native-extension.open-external-link',
                    href: 'https://external.example.test/forged-message'
                  }, '*');
                });
                setTimeout(function() {
                  [
                    { type: 'agentNative.host.ready', requestId: 'forged-ready' },
                    { type: 'agentNative.host.getContext', requestId: 'forged-context' },
                    { type: 'agentNative.host.listActions', requestId: 'forged-actions' },
                    { type: 'agentNative.host.runAction', requestId: 'forged-action', name: 'allowed-action', args: { value: 999 } },
                    { type: 'agentNative.host.command', requestId: 'forged-command', command: 'refreshData', payload: {} },
                    { type: 'agentNative.extension.storage', requestId: 'forged-storage', op: 'set', collection: 'notes', id: 'forged', data: { text: 'forged' }, options: { scope: 'user' } },
                  ].forEach(function(message) { window.parent.postMessage(message, '*'); });
                  setTimeout(function() {
                    window.parent.postMessage({
                      type: 'extension-e2e.replacement-report',
                      id: location.pathname === '/first-load-replacement' ? 'first-load' : 'after-handshake',
                      messages: receivedHostMessages,
                    }, '*');
                  }, 100);
                }, 50);
              </script>`
            : path === "/script-popup"
              ? `<!doctype html><p id="script-state">not run</p><script>document.getElementById('script-state').textContent='ran'</script>`
              : `<!doctype html><p>${title}</p><script>localStorage.setItem('external-page-loaded', 'yes')</script>`,
      });
    });

    await page.goto(serverUrl(server));
    try {
      await page.waitForFunction(() => window.__extensionE2EResult?.done, {
        timeout: 30_000,
      });
    } catch (error) {
      const hostHtml = await page.content();
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          ...logs,
          hostHtml.slice(0, 1000),
        ].join("\n"),
      );
    }

    expect(page.url()).toBe(serverUrl(server));
    const frames = await page.locator("iframe").all();
    expect(frames).toHaveLength(4);
    const sandbox = await frames[0].getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-popups");
    expect(sandbox).not.toContain("allow-popups-to-escape-sandbox");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-top-navigation-by-user-activation");

    const result = await page.evaluate(
      () => window.__extensionE2EResult as ExtensionE2EResult,
    );

    expect(result.context).toMatchObject({
      ok: true,
      value: {
        resource: { type: "customer", id: "customer-1", name: "Ada Co" },
        slot: {
          id: "crm.customer.sidebar",
          context: { customerId: "customer-1" },
        },
      },
    });
    expect(result.actions.ok).toBe(true);
    expect(result.actions.value?.map((action) => action.name)).toEqual([
      "allowed-action",
    ]);
    expect(result.allowedAction).toMatchObject({
      ok: true,
      value: { doubled: 6 },
    });
    expect(result.blockedAction.ok).toBe(false);
    expect(result.blockedAction.error).toContain("blocked-action");

    expect(result.allowedCommand).toMatchObject({
      ok: true,
      value: {
        refreshed: true,
        payload: { customerId: "customer-1" },
      },
    });
    expect(result.blockedCommand.ok).toBe(false);
    expect(result.blockedCommand.error).toContain("hardReload");
    expect(await page.locator("#command-count").textContent()).toBe("1");

    expect(result.storageSet).toMatchObject({
      ok: true,
      value: {
        id: "note-1",
        collection: "notes",
        data: { text: "Saved note" },
        scope: "user",
      },
    });
    expect(result.storageGet).toMatchObject({
      ok: true,
      value: {
        id: "note-1",
        data: { text: "Saved note" },
      },
    });
    expect(result.blockedStorageScope.ok).toBe(false);
    expect(result.blockedStorageScope.error).toContain('scope "org"');

    await page.locator("#change-context").click();
    await page.waitForFunction(
      () => window.__extensionE2EContextUpdate !== undefined,
      { timeout: 10_000 },
    );
    const contextUpdate = await page.evaluate(
      () => window.__extensionE2EContextUpdate,
    );
    expect(contextUpdate).toMatchObject({
      slotContext: { customerId: "customer-2" },
      hostContext: { slot: { context: { customerId: "customer-2" } } },
      action: { doubled: 10 },
      storage: { id: "note-1", data: { text: "Saved note" } },
    });
    expect(await page.evaluate(() => window.__extensionE2EActionCalls)).toBe(2);

    let extensionFrame = page.frames()[1];
    const storageBeforeReplacements = await page.evaluate(() =>
      Object.keys(localStorage)
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    );
    await page.waitForFunction(
      () => window.__extensionE2EReplacementMessages?.["first-load"],
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => window.__extensionE2EReplacementMessages?.["after-handshake"],
      { timeout: 10_000 },
    );
    const reports = await page.evaluate(
      () => window.__extensionE2EReplacementMessages,
    );
    for (const report of Object.values(reports ?? {})) {
      expect(report).not.toEqual(
        expect.arrayContaining([
          "agentNative.host.init",
          "agentNative.host.context",
          "agentNative.host.auth",
          "agentNative.host.actions",
          "agentNative.extension.slotContext",
          "agentNative.extension.storageResult",
        ]),
      );
    }
    const firstLoadFrame = page
      .frames()
      .find((frame) => frame.url().includes("/first-load-replacement"));
    expect(firstLoadFrame).toBeDefined();
    let replacementPopupOpened = false;
    const recordReplacementPopup = () => {
      replacementPopupOpened = true;
    };
    page.context().on("page", recordReplacementPopup);
    await firstLoadFrame.locator("#forge-link").click();
    await page.waitForTimeout(100);
    page.context().off("page", recordReplacementPopup);
    expect(replacementPopupOpened).toBe(false);

    expect(await page.evaluate(() => window.__extensionE2EActionCalls)).toBe(2);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    ).toEqual(storageBeforeReplacements);

    let forgedPopupOpened = false;
    const recordForgedPopup = () => {
      forgedPopupOpened = true;
    };
    page.context().on("page", recordForgedPopup);
    await extensionFrame.locator("#try-top-navigation").click();
    await page.waitForTimeout(100);
    expect(page.url()).toBe(serverUrl(server));
    await extensionFrame.evaluate(() => {
      window.parent.postMessage(
        {
          type: "agent-native-extension.open-external-link",
          href: "https://external.example.test/forged-message",
        },
        "*",
      );
    });
    await page.waitForTimeout(100);
    page.context().off("page", recordForgedPopup);
    expect(forgedPopupOpened).toBe(false);

    let scriptPopupOpened = false;
    const recordScriptPopup = () => {
      scriptPopupOpened = true;
    };
    page.context().on("page", recordScriptPopup);
    await extensionFrame.locator("#open-script-popup").click();
    await page.waitForTimeout(100);
    page.context().off("page", recordScriptPopup);
    expect(scriptPopupOpened).toBe(false);

    const iframeBeforeReload = await page
      .locator('iframe[title="Allowed extension"]')
      .elementHandle();
    expect(iframeBeforeReload).not.toBeNull();
    await extensionFrame.evaluate(() => window.location.reload());
    await page.waitForFunction(
      (previousFrame) =>
        document.querySelector('iframe[title="Allowed extension"]') !==
        previousFrame,
      iframeBeforeReload!,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('iframe[title="Allowed extension"]')
          ?.getAttribute("data-link-channel-ready") === "true",
      { timeout: 10_000 },
    );
    const recoveredIframe = await page
      .locator('iframe[title="Allowed extension"]')
      .elementHandle();
    expect(recoveredIframe).not.toBeNull();
    const recoveredExtensionFrame = await recoveredIframe!.contentFrame();
    expect(recoveredExtensionFrame).not.toBeNull();
    extensionFrame = recoveredExtensionFrame!;
    await extensionFrame.waitForSelector("#external-metric-link");

    const metricPopupPromise = page.context().waitForEvent("page");
    await recoveredExtensionFrame.locator("#external-metric-link").click();
    const metricPopup = await metricPopupPromise;
    await metricPopup.waitForURL("https://external.example.test/metric");
    expect(await metricPopup.locator("body").textContent()).toContain("metric");
    expect(await metricPopup.evaluate(() => window.opener)).toBeNull();
    expect(
      await metricPopup.evaluate(() =>
        localStorage.getItem("external-page-loaded"),
      ),
    ).toBe("yes");
    expect(page.url()).toBe(serverUrl(server));
    await metricPopup.close();

    const svgPopupPromise = page.context().waitForEvent("page");
    await extensionFrame.locator("#svg-metric-link").click();
    const svgPopup = await svgPopupPromise;
    await svgPopup.waitForURL("https://external.example.test/svg");
    expect(await svgPopup.locator("body").textContent()).toContain("svg");
    expect(await svgPopup.evaluate(() => window.opener)).toBeNull();
    expect(page.url()).toBe(serverUrl(server));
    await svgPopup.close();

    const xlinkPopupPromise = page.context().waitForEvent("page");
    await extensionFrame.locator("#xlink-svg-metric-link").click();
    const xlinkPopup = await xlinkPopupPromise;
    await xlinkPopup.waitForURL("https://external.example.test/xlink-svg");
    expect(await xlinkPopup.locator("body").textContent()).toContain(
      "xlink svg",
    );
    expect(await xlinkPopup.evaluate(() => window.opener)).toBeNull();
    await xlinkPopup.close();

    await page.close();
  }, 60_000);

  it("opens external links from server-rendered extension frames", async () => {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on("console", (message) =>
      logs.push(`[console:${message.type()}] ${message.text()}`),
    );
    page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));
    await page
      .context()
      .route("https://external.example.test/route-metric", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Route metric</title><p>Route metric</p>",
        }),
      );

    try {
      await page.goto(serverUrl(server));
      await page.waitForFunction(
        () => window.__extensionRouteLinkReadyCount === 1,
        { timeout: 10_000 },
      );
      const initialRouteFrame = page
        .frames()
        .find((frame) => frame.url().includes("/__extension-e2e-route"));
      expect(initialRouteFrame).toBeDefined();
      const routeReadyCount = await page.evaluate(
        () => window.__extensionRouteLinkReadyCount ?? 0,
      );
      const routeReload = initialRouteFrame!.waitForNavigation({
        waitUntil: "load",
      });
      await initialRouteFrame!.evaluate(() => window.location.reload());
      await routeReload;
      await page.waitForFunction(
        (previousReadyCount) =>
          (window.__extensionRouteLinkReadyCount ?? 0) > previousReadyCount,
        routeReadyCount,
        { timeout: 10_000 },
      );
      const routeFrame = page
        .frames()
        .find((frame) => frame.url().includes("/__extension-e2e-route"));
      expect(routeFrame).toBeDefined();
      const extensionFrame = page.frameLocator(
        'iframe[data-e2e-route-link="true"]',
      );
      const popupPromise = page.context().waitForEvent("page", {
        timeout: 5_000,
      });
      await extensionFrame.locator("#route-external-link").click();
      const popup = await popupPromise.catch((error) => {
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            ...logs,
            `frames: ${page
              .frames()
              .map((frame) => frame.url())
              .join(", ")}`,
          ].join("\n"),
        );
      });
      await popup.waitForURL("https://external.example.test/route-metric");
      expect(await popup.locator("body").textContent()).toContain(
        "Route metric",
      );
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      expect(page.url()).toBe(serverUrl(server));
      await popup.close();

      const currentRouteFrame = page
        .frames()
        .find((frame) => frame.url().includes("/__extension-e2e-route"));
      expect(currentRouteFrame).toBeDefined();
      const formSubmitPromise = currentRouteFrame!.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            window.addEventListener(
              "submit",
              (event) => resolve(event.defaultPrevented),
              { once: true },
            );
          }),
      );
      await routeFrame!.locator("#route-external-form").click();
      expect(await formSubmitPromise).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("routes same-origin links through the host and preserves named contexts", async () => {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());

    try {
      await page.goto(serverUrl(server));
      await page.waitForFunction(() => window.__extensionE2EResult?.done, {
        timeout: 30_000,
      });
      const extensionFrame = page
        .frameLocator('iframe[sandbox*="allow-scripts"]')
        .first();

      let extensionRenderNavigations = 0;
      page.on("request", (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          (new URL(request.url()).pathname.startsWith(
            "/_agent-native/extensions/unsafe-extension/",
          ) ||
            new URL(request.url()).pathname.startsWith(
              "/_agent-native/tools/unsafe-extension/",
            ))
        ) {
          extensionRenderNavigations += 1;
        }
      });
      const hostUrl = page.url();
      const hostPageCount = page.context().pages().length;
      await extensionFrame
        .locator("#same-origin-extension-render-link")
        .click();
      await extensionFrame
        .locator("#same-origin-extension-render-new-context-link")
        .click();
      await extensionFrame
        .locator("#same-origin-legacy-tools-render-link")
        .click();
      await extensionFrame
        .locator("#same-origin-legacy-tools-render-new-context-link")
        .click();
      await page.waitForTimeout(100);
      expect(extensionRenderNavigations).toBe(0);
      expect(page.url()).toBe(hostUrl);
      expect(page.context().pages()).toHaveLength(hostPageCount);
      expect(
        await page.locator("html").getAttribute("data-unsafe-extension-loaded"),
      ).toBeNull();

      const popupPromise = page.context().waitForEvent("page");
      await extensionFrame.locator("#same-origin-named-link").click();
      const popup = await popupPromise;
      await popup.waitForURL(
        new URL("/__extension-e2e-app-popup", serverUrl(server)).href,
      );
      expect(await popup.locator("#app-popup").textContent()).toBe("App popup");
      await popup.close();

      await extensionFrame.locator("#same-origin-app-link").click();
      await page.waitForURL(
        new URL("/__extension-e2e-app-target", serverUrl(server)).href,
      );
      expect(await page.locator("#app-target").textContent()).toBe(
        "App target",
      );
    } finally {
      await page.close();
    }
  }, 60_000);
});

declare global {
  interface Window {
    __extensionE2EResult?: ExtensionE2EResult;
    __extensionE2ECommands?: Array<{ command: string; payload: unknown }>;
    __extensionRouteLinkReadyCount?: number;
  }
}
