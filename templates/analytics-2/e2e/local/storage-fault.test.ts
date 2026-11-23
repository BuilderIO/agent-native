import assert from "node:assert/strict";
import { test } from "node:test";

import { startFakeProviders } from "./fake-providers.js";

test("Storage fault leaves the original BigQuery job readable through REST", async () => {
  const fixture = await startFakeProviders();
  try {
    const query = new URL(
      "/bigquery/v2/projects/local-fake-project/queries",
      fixture.url,
    );
    const headers = {
      "x-fake-host": "bigquery.googleapis.com",
      "content-type": "application/json",
    };
    const submitted = await fetch(query, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "select 42 as sentinel" }),
    });
    assert.equal(submitted.status, 200);
    const started = await submitted.json();
    const jobId = started.jobReference.jobId;
    const storage = new URL("/__control/storage", fixture.url);
    storage.search = new URLSearchParams({
      projectId: "local-fake-project",
      jobId,
      offset: "0",
    }).toString();
    const read = await fetch(storage);
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).rows, [{ sentinel: "42" }]);

    const fault = await fetch(new URL("/__control/scenario", fixture.url), {
      method: "POST",
      body: JSON.stringify({ bigqueryStorageFailure: true }),
    });
    await fault.arrayBuffer();
    assert.equal(fault.status, 200);
    const interrupted = await fetch(storage);
    await interrupted.arrayBuffer();
    assert.equal(interrupted.status, 503);

    const rest = await fetch(`${query}/${jobId}`, { headers });
    assert.equal(rest.status, 200);
    assert.deepEqual(await rest.json(), started);
    assert.equal(
      fixture.calls.filter(
        (call) => call.method === "POST" && call.path.endsWith("/queries"),
      ).length,
      1,
    );
    assert.deepEqual(
      fixture.calls
        .filter((call) => call.host === "storage")
        .map((call) => call.jobId),
      [jobId, jobId],
    );
  } finally {
    await fixture.close();
  }
});
