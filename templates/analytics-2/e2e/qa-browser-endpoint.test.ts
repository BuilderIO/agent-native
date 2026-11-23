import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { qaBrowserEndpoint } from "./qa-cdp-proxy.js";

const loopback = "127.0.0.1";

await test("the assigned browser endpoint is used and foreign endpoints are rejected", async () => {
  const previous = process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT;
  let endpoint = "";
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ webSocketDebuggerUrl: endpoint }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = String(address.port);
  process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT = port;
  try {
    endpoint = `ws://${loopback}:${port}/devtools/browser/qa-owned`;
    assert.equal((await qaBrowserEndpoint()).url.href, endpoint);
    assert.deepEqual(paths, ["/json/version"]);
    for (const invalid of [
      `ws://example.test:${port}/devtools/browser/qa-owned`,
      `ws://${loopback}:${address.port === 65535 ? 65534 : address.port + 1}/devtools/browser/qa-owned`,
      `http://${loopback}:${port}/devtools/browser/qa-owned`,
    ]) {
      endpoint = invalid;
      await assert.rejects(
        qaBrowserEndpoint(),
        /Unexpected QA browser endpoint/,
      );
    }
    const reads = paths.length;
    for (const invalid of ["80", "65536", "invalid", "9455/path"]) {
      process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT = invalid;
      await assert.rejects(qaBrowserEndpoint(), /QA browser port is invalid/);
    }
    assert.equal(paths.length, reads);
  } finally {
    if (previous === undefined)
      delete process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT;
    else process.env.AGENT_NATIVE_ANALYTICS_QA_BROWSER_PORT = previous;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
