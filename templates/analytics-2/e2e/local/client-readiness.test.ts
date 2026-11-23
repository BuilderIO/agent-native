import assert from "node:assert/strict";
import { test } from "node:test";

import { prepareClient } from "./client-readiness.ts";

await test("report A2-DAILY-OPTIMIZER-COLD-ENTRY admits the browser only after scan, transforms, crawl and dependency output", async () => {
  const scan = Promise.withResolvers<void>();
  const crawl = Promise.withResolvers<void>();
  const output = Promise.withResolvers<void>();
  const urls: string[] = [];
  let crawled = false;
  let ready = false;
  const pending = prepareClient({
    async transformRequest(url) {
      urls.push(url);
    },
    async waitForRequestsIdle() {
      crawled = true;
      await crawl.promise;
    },
    depsOptimizer: {
      scanProcessing: scan.promise,
      metadata: {
        optimized: {},
        discovered: { react: { processing: output.promise } },
      },
    },
  }).then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(urls.length, 0);
  scan.resolve();
  await new Promise<void>((done) => setImmediate(done));
  assert.ok(urls.includes("/app/root.tsx"));
  assert.ok(urls.includes("/app/components/workspace/HomePageView.tsx"));
  assert.ok(urls.includes("/app/components/agent/index.ts"));
  assert.ok(urls.includes("/app/components/notebook/NotebookCell.tsx"));
  assert.equal(crawled, true);
  assert.equal(ready, false);
  crawl.resolve();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(ready, false);
  output.resolve();
  await pending;
  assert.equal(ready, true);
});

await test("client transform failure blocks browser admission without a retry", async () => {
  let calls = 0;
  const failure = new Error("transform failed");
  await assert.rejects(
    prepareClient({
      async transformRequest() {
        calls++;
        throw failure;
      },
      async waitForRequestsIdle() {
        assert.fail("failed transforms cannot be ready");
      },
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 6);
});
