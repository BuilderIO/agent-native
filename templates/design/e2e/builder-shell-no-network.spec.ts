import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";


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

  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/_agent-native/")) return;
    const path = url.replace(String(baseURL), "");
    if (path.startsWith("/_agent-native/webmcp/manifest")) return;
    requests.push(`${request.method()} ${path}`);
  });

  try {
    await page.goto(hostUrl, { waitUntil: "domcontentloaded" });
    const shell = page.frameLocator("#design");
    await expect(
      shell.getByText("Fusion home", { exact: false }).first(),
    ).toBeVisible();

    for (const label of [
      "Assets",
      "Import",
      "Tools",
      "Tokens",
      "Code",
      "File",
    ]) {
      await shell
        .getByText(label, { exact: true })
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    }
    await shell
      .getByText("Fusion home", { exact: false })
      .first()
      .dblclick({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    expect(
      requests,
      `unauthorized requests from the shell:\n${requests.join("\n")}`,
    ).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
