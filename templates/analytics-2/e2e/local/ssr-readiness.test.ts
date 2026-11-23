import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { waitForSsr } from "./ssr-readiness";

await test("report A2-DAILY-DOCUMENT-READINESS waits until a browser document can pass the startup gate", async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.headers.accept?.includes("text/html") && requests === 1) {
      res.writeHead(503).end("Dev server is restarting");
    } else res.end("<html>ready</html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await waitForSsr(`http://127.0.0.1:${address.port}`);
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

await test("startup fails when the document remains unavailable and the server disconnects", async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (requests === 1) res.writeHead(503).end("Dev server is restarting");
    else req.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(waitForSsr(`http://127.0.0.1:${address.port}`));
    assert.equal(requests, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
