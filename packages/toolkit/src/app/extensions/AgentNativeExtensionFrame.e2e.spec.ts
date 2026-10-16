import { buildExtensionHtml } from "@agent-native/core/extensions/html-shell";
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
                '<a id="route-external-link" href="https://external.example.test/route-metric">Open route metric</a>',
                ":root{}",
                false,
                "route-extension",
              ),
            );
          });
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

describe("AgentNativeExtensionFrame browser bridge", () => {
  let server: ViteDevServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await startHostServer();
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }, 60_000);

  it("runs a sandboxed extension through real iframe postMessage boundaries", async () => {
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
    await page.route(
      "https://external.example.test/first-load-replacement",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html>
<script>
  window.addEventListener('message', function(event) {
    if (!event.ports || event.ports.length !== 1) return;
    window.parent.postMessage({ type: 'extension-e2e.replacement-port-received' }, '*');
  });
  window.parent.postMessage({
    type: 'agentNative.extension.readyExternalLinkBridge',
    nonce: 'forged',
    generation: 'replacement'
  }, '*');
</script>
<p>First-load replacement document</p>`,
        }),
    );

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
    expect(frames).toHaveLength(3);
    const sandbox = await frames[0].getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
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

    await page
      .frames()[2]
      .waitForURL("https://external.example.test/first-load-replacement");
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(
        () => window.__extensionReplacementPortReceived ?? false,
      ),
    ).toBe(false);
    expect(page.url()).toBe(serverUrl(server));

    await page.route("https://external.example.test/replacement", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html>
<script>
  window.addEventListener('message', function(event) {
    if (!event.ports || event.ports.length !== 1) return;
    window.parent.postMessage({ type: 'extension-e2e.replacement-port-received' }, '*');
    event.ports[0].postMessage({
      type: 'agentNative.extension.openExternalLink',
      href: 'https://attacker.example.test/redirect',
      target: '_self'
    });
  });
</script>
<p>Replacement document</p>`,
      }),
    );
    const replacementFrame = page.frames()[1];
    await replacementFrame.evaluate(() => {
      window.location.assign("https://external.example.test/replacement");
    });
    await replacementFrame.waitForURL(
      "https://external.example.test/replacement",
    );
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(
        () => window.__extensionReplacementPortReceived ?? false,
      ),
    ).toBe(false);
    expect(page.url()).toBe(serverUrl(server));

    await page.reload();
    await page.waitForFunction(() => window.__extensionE2EResult?.done, {
      timeout: 30_000,
    });

    const extensionFrame = page.frames()[1];
    await extensionFrame.evaluate(() => window.location.reload());
    await extensionFrame.waitForSelector("#external-metric-link");

    await page.route("https://external.example.test/metric", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Metric target</title><p>Metric target</p>",
      }),
    );
    await extensionFrame.locator("#external-metric-link").click();
    await page.waitForURL("https://external.example.test/metric");
    expect(await page.locator("body").textContent()).toContain("Metric target");

    await page.close();
  }, 60_000);

  it("routes external links from server-rendered extension frames through the host", async () => {
    const page = await browser.newPage();
    await page.route("https://external.example.test/route-metric", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Route metric</title><p>Route metric</p>",
      }),
    );

    try {
      await page.goto(serverUrl(server));
      const extensionFrame = page.frameLocator(
        'iframe[data-e2e-route-bridge="true"]',
      );
      await extensionFrame.locator("#route-external-link").click();
      await page.waitForURL("https://external.example.test/route-metric");
      expect(await page.locator("body").textContent()).toContain(
        "Route metric",
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
    __extensionReplacementPortReceived?: boolean;
  }
}
