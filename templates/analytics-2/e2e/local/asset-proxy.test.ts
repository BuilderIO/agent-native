import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { test } from "node:test";

import { startFakeProviders } from "./fake-providers";

await test("report A2-DAILY-OPTIMIZER-CACHE does not retain mutable assets or failed requests", async () => {
  let version = "old";
  let immutableRequests = 0;
  let failureRequests = 0;
  let disconnectRequests = 0;
  const app = createServer((req, res) => {
    if (req.url?.startsWith("/disconnect")) {
      disconnectRequests++;
      if (disconnectRequests === 1) req.socket.destroy();
      else res.end("recovered");
    } else if (req.url?.startsWith("/immutable")) {
      immutableRequests++;
      res
        .writeHead(200, {
          "cache-control": "public, max-age=31536000, immutable",
        })
        .end(version);
    } else if (req.url?.startsWith("/failure")) {
      failureRequests++;
      res.writeHead(504, { "cache-control": "immutable" }).end();
    } else res.writeHead(200, { "cache-control": "no-cache" }).end(version);
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const proxy = await startFakeProviders({ appPort: address.port });
  async function get(path: string) {
    return new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: proxy.port,
            path: `http://127.0.0.1:${address.port}${path}`,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode, body }));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
  }
  try {
    assert.equal((await get("/source.tsx")).body, "old");
    assert.equal((await get("/immutable.js")).body, "old");
    version = "new";
    assert.equal((await get("/source.tsx")).body, "new");
    assert.equal((await get("/immutable.js")).body, "old");
    assert.equal(immutableRequests, 1);
    assert.equal((await get("/failure.js")).status, 504);
    assert.equal((await get("/failure.js")).status, 504);
    assert.equal(failureRequests, 2);
    assert.equal((await get("/disconnect.js")).status, 500);
    assert.equal((await get("/disconnect.js")).body, "recovered");
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
