import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createH3SSRHandler } from "../server/ssr-handler.js";
import { ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT } from "../shared/route-chunk-recovery-bootstrap.js";

type Build = "A" | "B";

interface AppWindow extends Window {
  appBuild?: Build;
  openPanel: () => Promise<Build>;
}

const deploy = vi.hoisted(() => ({
  live: "A" as "A" | "B",
  render: (_request: Request): Response => new Response(null),
}));

vi.mock("react-router", () => ({
  createRequestHandler: () => (request: Request) => deploy.render(request),
}));

const NON_LOOPBACK_HOST = "app.agent-native.test";
const CLOUDFLARE_DEFAULT_CACHE_CONTROL = "max-age=14400";

async function launchBrowser(): Promise<Browser> {
  const args = [`--host-resolver-rules=MAP ${NON_LOOPBACK_HOST} 127.0.0.1`];
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true, args });
  }
}

async function entryScript(buildName: Build): Promise<string> {
  const here = fileURLToPath(import.meta.url);
  const result = await build({
    stdin: {
      contents: `
        import { installRouteChunkRecovery } from "./route-chunk-recovery.js";
        installRouteChunkRecovery();
        window.appBuild = ${JSON.stringify(buildName)};
        const panel = "/assets/panel-${buildName}.js";
        const settings = "/assets/settings-${buildName}.js";
        window.openPanel = async () => (await import(panel)).build;
        // What React Router does when a route's module fails to load.
        const openSettings = async () => {
          try {
            await import(settings);
          } catch {
            console.error("Error loading route module \`" + settings + "\`, reloading page...");
            window.location.reload();
          }
        };
        document.querySelector("button").addEventListener("click", () => {
          void window.openPanel();
        });
        document.querySelector("a").addEventListener("click", (event) => {
          event.preventDefault();
          void openSettings();
        });
      `,
      resolveDir: dirname(here),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    define: { "import.meta.env": "{}" },
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

describe("stale chunk recovery in a real browser", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  let page: Page;
  let documents: string[];
  const entries: Record<Build, string> = { A: "", B: "" };
  const missing = new Set<string>();
  const ssrHandler = createH3SSRHandler(() => ({})) as unknown as (event: {
    url: URL;
    req: Request;
  }) => Promise<Response>;

  function asset(pathname: string): string | undefined {
    if (missing.has(pathname)) return undefined;
    switch (pathname) {
      case `/assets/entry-${deploy.live}.js`:
        return entries[deploy.live];
      case `/assets/panel-${deploy.live}.js`:
      case `/assets/settings-${deploy.live}.js`:
        return `export const build = ${JSON.stringify(deploy.live)};`;
      default:
        return undefined;
    }
  }

  async function respond(url: URL, res: ServerResponse): Promise<void> {
    const script = asset(url.pathname);
    if (script !== undefined) {
      res.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(script);
      return;
    }
    const response = await ssrHandler({ url, req: new Request(url) });
    if (response.status === 200) {
      documents.push(`${deploy.live} ${url.pathname}`);
    }
    const headers = Object.fromEntries(response.headers);
    headers["cache-control"] ??= CLOUDFLARE_DEFAULT_CACHE_CONTROL;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  beforeAll(async () => {
    deploy.render = () =>
      new Response(
        `<!doctype html><html><head><script>${ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT}</script><script type="module" src="/assets/entry-${deploy.live}.js"></script></head><body><button>Panel</button><a href="/settings">Settings</a></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    [entries.A, entries.B] = await Promise.all([
      entryScript("A"),
      entryScript("B"),
    ]);
    server = createServer((req, res) => {
      respond(new URL(req.url ?? "/", origin), res).catch((error: unknown) => {
        res.writeHead(500);
        res.end(String(error));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    origin = `http://${NON_LOOPBACK_HOST}:${address.port}`;
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }, 60_000);

  beforeEach(async () => {
    deploy.live = "A";
    documents = [];
    missing.clear();
    page = await (await browser.newContext()).newPage();
  });

  afterEach(async () => {
    await page.context().close();
  });

  function liveBuild(target: Page): Promise<Build | undefined> {
    return target.evaluate(() => (window as unknown as AppWindow).appBuild);
  }

  async function waitForBuild(target: Page, expected: Build): Promise<void> {
    await target.waitForFunction(
      (name) => (window as unknown as AppWindow).appBuild === name,
      expected,
    );
  }

  function openPanel(): Promise<Build | "failed"> {
    return page.evaluate(() =>
      (window as unknown as AppWindow)
        .openPanel()
        .catch(() => "failed" as const),
    );
  }

  it("moves a tab from before a deploy onto the new build", async () => {
    const address = `${origin}/inbox?tab=all#first`;
    await page.goto(address);
    await waitForBuild(page, "A");
    deploy.live = "B";

    const tabGivenCachedPage = await page.context().newPage();
    await tabGivenCachedPage.goto(address);
    await waitForBuild(tabGivenCachedPage, "A");
    await tabGivenCachedPage.close();

    await page.click("button");

    await waitForBuild(page, "B");
    expect(documents).toEqual([
      "A /inbox",
      "B /inbox/__agent-native-chunk-recovery",
    ]);
    expect(page.url()).toBe(address);
    expect(await openPanel()).toBe("B");
  });

  it("opens the clicked route on the new build when its module is gone", async () => {
    await page.goto(`${origin}/inbox`);
    await waitForBuild(page, "A");
    deploy.live = "B";

    await page.click("a");

    await waitForBuild(page, "B");
    expect(page.url()).toBe(`${origin}/settings`);
  });

  it("asks for a missing file again after a reload", async () => {
    missing.add("/assets/panel-A.js");
    await page.goto(`${origin}/inbox`);
    await waitForBuild(page, "A");
    expect(await openPanel()).toBe("failed");

    missing.clear();
    await page.reload();

    expect(await liveBuild(page)).toBe("A");
    expect(await openPanel()).toBe("A");
  });
});
