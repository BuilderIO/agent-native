import { chromium, type Browser } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOST_HTML = `<!doctype html>
<html>
  <head><title>route-chunk-recovery E2E</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/route-chunk-recovery.e2e-host.ts"></script>
  </body>
</html>`;

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true });
  }
}

/**
 * A real Vite dev server, not a mock. This is the point of this test: the
 * unit specs in route-chunk-recovery.spec.ts mock `location` as a plain
 * object, which is exactly what let a real bug (browsers make
 * Location.reload/assign/replace Unforgeable, so patchReload()'s override
 * never installs) slip through 27 passing tests undetected. Only testing
 * against a real browser's real Location catches that class of bug.
 */
async function startHostServer(
  galleryModuleState: { failNextRequest: boolean },
): Promise<ViteDevServer> {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "route-chunk-recovery-e2e",
        configureServer(devServer) {
          devServer.middlewares.use((req, res, next) => {
            const url = req.url ?? "";
            if (url.startsWith("/src/client/e2e-gallery.js")) {
              if (galleryModuleState.failNextRequest) {
                galleryModuleState.failNextRequest = false;
                res.statusCode = 500;
                res.end("simulated: route module not ready yet");
                return;
              }
              next();
              return;
            }
            // SPA fallback: any other non-asset path (e.g. a direct
            // location.assign("/gallery") navigation) gets the same host
            // page, which then renders based on the current pathname.
            if (
              url === "/" ||
              (!url.includes(".") && !url.startsWith("/@") && !url.startsWith("/src/"))
            ) {
              res.setHeader("Content-Type", "text/html");
              res.end(HOST_HTML);
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  return server;
}

function serverUrl(server: ViteDevServer, path = "/"): string {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite did not expose a local URL");
  return new URL(path, url).toString();
}

describe("route chunk recovery against a real browser", () => {
  let server: ViteDevServer;
  let browser: Browser;
  const galleryModuleState = { failNextRequest: true };

  beforeAll(async () => {
    server = await startHostServer(galleryModuleState);
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([browser?.close(), server?.close()]);
  }, 60_000);

  it("finishes a nav-link click even when the target route module fails once", async () => {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(serverUrl(server));
    await page.waitForFunction(
      () => window.__routeChunkRecoveryE2E?.ready === true,
    );
    expect(await page.textContent("#page")).toBe("HOME");

    await page.click("#gallery-link");

    // The first attempt fails and React Router's real reload() behavior -
    // reproduced verbatim in the host script - reloads the current (still
    // "/") page. installRouteChunkRecovery() must finish the interrupted
    // click once that reload lands, without ever needing to intercept
    // reload() itself.
    await page.waitForURL((url) => url.pathname === "/gallery", {
      timeout: 10_000,
    });
    await page.waitForFunction(
      () => document.getElementById("page")?.textContent === "GALLERY",
      undefined,
      { timeout: 10_000 },
    );

    expect(new URL(page.url()).pathname).toBe("/gallery");
    expect(
      consoleErrors.some((line) =>
        line.includes("Error loading route module"),
      ),
    ).toBe(true);

    await page.close();
  }, 30_000);
});
