import { createServer, type Server } from "node:http";

import { expect, test } from "./rails";

const STUB_APP = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Stub app</title></head>
<body style="margin:0;font-family:system-ui">
  <main data-agent-native-node-id="runtime-root" data-agent-native-layer-name="Main">
    <h1 data-agent-native-node-id="runtime-title" data-agent-native-layer-name="Title">Stub app</h1>
  </main>
</body></html>`;

function hostStub(shellUrl: string, previewUrl: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Builder host stub</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100vw;height:100vh}</style></head>
<body>
  <iframe id="design" src="${shellUrl}"></iframe>
  <script>
    var frame = document.getElementById('design');
    function init() {
      frame.contentWindow.postMessage({
        type: 'design:init',
        data: {
          version: 2,
          previewUrl: ${JSON.stringify(previewUrl)},
          routes: [{ path: '/' }, { path: '/about' }],
          context: { builderOrgId: 'org-e2e', projectId: 'proj-e2e', branchName: 'e2e', contentId: null },
          capabilities: ['chat', 'close'],
        },
      }, '*');
    }
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'agentNative.appReady') init();
    });
    frame.addEventListener('load', function () { setTimeout(init, 300); });
  </script>
</body></html>`;
}

async function startHostStub(
  shellUrl: string,
): Promise<{ server: Server; hostUrl: string }> {
  const server = createServer((request, response) => {
    const port = (server.address() as { port: number }).port;
    const previewUrl = `http://127.0.0.1:${port}/stub-app.html`;
    const body = request.url?.startsWith("/stub-app.html")
      ? STUB_APP
      : hostStub(shellUrl, previewUrl);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, hostUrl: `http://127.0.0.1:${port}/builder-host-stub.html` };
}

test.use({ storageState: { cookies: [], origins: [] } });

test("the Builder shell canvas makes no agent-native requests", async ({
  page,
  baseURL,
}) => {
  const shellUrl = `${baseURL}/visual-edit/shell?view=overview&embedChrome=1`;
  const { server, hostUrl } = await startHostStub(shellUrl);
  const isAgentNativeRequest = (url: string) =>
    url.includes("/_agent-native/") &&
    !url.includes("/_agent-native/webmcp/manifest");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (isAgentNativeRequest(request.url())) {
      requests.push(
        `${request.method()} ${request.url().replace(String(baseURL), "")}`,
      );
    }
  });

  try {
    await page.goto(hostUrl, { waitUntil: "domcontentloaded" });
    const shell = page.frameLocator("#design");
    await expect(shell.locator("[data-screen-shell]")).toHaveCount(2);
    const rail = shell.locator('[data-design-chrome-region="workspace-rail"]');

    await rail.getByRole("button", { name: "Tokens", exact: true }).click();
    await expect(
      rail.getByRole("button", { name: "Tokens", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      shell.getByText("Tokens require editor access", { exact: true }),
    ).toBeVisible();
    await rail.getByRole("button", { name: "Layers", exact: true }).click();
    const layers = shell.getByRole("tree", { name: "Layers" });
    await expect(layers.getByRole("treeitem")).toHaveText([
      "Fusion about",
      "Fusion home",
    ]);
    await layers.getByRole("treeitem", { name: "Fusion about" }).click();
    await expect(
      shell.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveText(["Fusion about"]);
    await shell
      .locator("[data-frame-title]")
      .filter({ hasText: "Fusion home" })
      .dblclick();
    await page.keyboard.press("Escape");

    await expect(
      page.waitForRequest((request) => isAgentNativeRequest(request.url()), {
        timeout: 3000,
      }),
    ).rejects.toThrow(/Timeout/);
    expect(
      requests,
      `unauthorized requests from the shell:\n${requests.join("\n")}`,
    ).toStrictEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
