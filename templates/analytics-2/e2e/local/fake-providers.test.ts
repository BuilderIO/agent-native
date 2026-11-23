import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultScenario, startFakeProviders } from "./fake-providers";

await test("BigQuery query results paginate across requests for the same job", async () => {
  const scenario = defaultScenario();
  scenario.tables.push({
    dataset: "paging",
    name: "numbers",
    columns: [{ name: "id", type: "INT64" }],
    rows: Array.from({ length: 1502 }, (_, id) => ({ id })),
  });
  const server = await startFakeProviders({ scenario });
  type Result = {
    jobReference: { jobId: string; projectId: string; location: string };
    totalRows: string;
    pageToken?: string;
    rows: Array<{ f: Array<{ v: string }> }>;
  };
  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<Result> {
    const response = await fetch(new URL(path, server.url), {
      ...init,
      headers: { "x-fake-host": "bigquery.googleapis.com" },
    });
    assert.equal(response.status, 200);
    return (await response.json()) as Result;
  }
  try {
    const first = await request(
      "bigquery/v2/projects/local-fake-project/queries",
      {
        method: "POST",
        body: JSON.stringify({
          query: "SELECT * FROM paging.numbers",
          maxResults: 1000,
        }),
      },
    );
    assert.equal(first.totalRows, "1502");
    assert.equal(first.rows.length, 1000);
    assert.ok(first.pageToken);
    const path = `bigquery/v2/projects/local-fake-project/queries/${first.jobReference.jobId}`;
    const second = await request(
      `${path}?maxResults=300&pageToken=${encodeURIComponent(first.pageToken)}`,
    );
    assert.deepEqual(second.jobReference, first.jobReference);
    assert.equal(second.totalRows, "1502");
    assert.equal(second.rows.length, 300);
    assert.ok(second.pageToken);
    const third = await request(
      `${path}?maxResults=300&pageToken=${encodeURIComponent(second.pageToken)}`,
    );
    assert.deepEqual(third.jobReference, first.jobReference);
    assert.equal(third.totalRows, "1502");
    assert.equal(third.rows.length, 202);
    assert.equal(third.pageToken, undefined);
    assert.deepEqual(
      [...first.rows, ...second.rows, ...third.rows].map((row) => row.f[0]?.v),
      Array.from({ length: 1502 }, (_, id) => String(id)),
    );
  } finally {
    await server.close();
  }
});

await test("native warehouse jobs validate without executing and preserve submitted identities", async () => {
  const scenario = defaultScenario();
  scenario.tables.push({
    dataset: "native_fixture",
    name: "rows",
    columns: [
      { name: "word", type: "STRING" },
      { name: "word_count", type: "INT64" },
    ],
    rows: [
      { word: "alpha", word_count: 2 },
      { word: "beta", word_count: 1 },
    ],
  });
  const server = await startFakeProviders({ scenario });
  const reference = {
    projectId: scenario.projectId,
    jobId: "qa_native_job",
    location: "US",
  };
  const configuration = {
    query: { query: "SELECT * FROM native_fixture.rows", useLegacySql: false },
  };
  const jobs = `bigquery/v2/projects/${scenario.projectId}/jobs`;
  const request = (path: string, body?: unknown) =>
    fetch(new URL(path, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-fake-host": "bigquery.googleapis.com" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const dry = await request(jobs, {
      jobReference: reference,
      configuration: { ...configuration, dryRun: true },
    });
    assert.equal(dry.status, 200);
    const validation = await dry.json();
    assert.equal(validation.statistics?.query?.statementType, "SELECT");
    assert.equal(validation.jobReference?.projectId, scenario.projectId);
    assert.equal(validation.jobReference?.location, "US");
    assert.equal((await request(`${jobs}/${reference.jobId}`)).status, 404);
    const admitted = await request(jobs, {
      jobReference: reference,
      configuration,
    });
    assert.equal(admitted.status, 200);
    assert.deepEqual(await admitted.json(), {
      kind: "bigquery#job",
      jobReference: reference,
      status: { state: "DONE" },
    });
    assert.deepEqual(
      await (await request(`${jobs}/${reference.jobId}`)).json(),
      {
        kind: "bigquery#job",
        jobReference: reference,
        status: { state: "DONE" },
      },
    );
    const duplicate = await request(jobs, {
      jobReference: reference,
      configuration,
    });
    assert.equal(duplicate.status, 409);
    const first = await (
      await request(
        `bigquery/v2/projects/${scenario.projectId}/queries/${reference.jobId}?maxResults=1`,
      )
    ).json();
    assert.equal(first.totalRows, "2");
    assert.deepEqual(first.rows, [{ f: [{ v: "alpha" }, { v: "2" }] }]);
    assert.equal(typeof first.pageToken, "string");
    const next = await (
      await request(
        `bigquery/v2/projects/${scenario.projectId}/queries/${reference.jobId}?maxResults=1&pageToken=${encodeURIComponent(first.pageToken)}`,
      )
    ).json();
    assert.deepEqual(next.rows, [{ f: [{ v: "beta" }, { v: "1" }] }]);
    assert.equal(next.pageToken, undefined);
  } finally {
    await server.close();
  }
});
