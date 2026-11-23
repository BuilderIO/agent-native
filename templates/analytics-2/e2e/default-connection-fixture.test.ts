import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDefaultConnectionFixture,
  prepareDefaultConnectionFixture,
} from "./default-connection-fixture.js";

const connection = {
  id: "connection-a",
  name: "Warehouse",
  type: "bigquery",
  isDefault: true,
  isDraft: false,
};
const page = (items: unknown[]) => ({
  items,
  endCursor: null,
  hasNextPage: false,
});
const schema = {
  id: "schema:project:dataset",
  name: "dataset",
  kind: "schema",
  hasChildren: true,
};
const table = {
  id: "table:project:dataset:table",
  name: "table",
  kind: "table",
  hasChildren: false,
};

await test("discovers a bounded table probe on the selected default", async () => {
  const calls: string[] = [];
  const result = await prepareDefaultConnectionFixture(async (name, data) => {
    calls.push(name);
    if (name === "list-data-connections") return { connections: [connection] };
    if (name === "list-connection-datasets")
      return page(data.parentId ? [table] : [schema]);
    throw new Error(`Unexpected action ${name}`);
  });
  assert.deepEqual(result, {
    status: "ready",
    selected: {
      id: connection.id,
      name: connection.name,
      type: connection.type,
    },
    connectionId: connection.id,
    query: "SELECT 1 AS qa_value FROM `project.dataset.table` LIMIT 1",
    expectedRows: [[1]],
  });
  assert.deepEqual(calls, [
    "list-data-connections",
    "list-connection-datasets",
    "list-connection-datasets",
    "list-data-connections",
  ]);
});

await test("refuses a changed default, unreadable catalog, empty catalog, and unsupported dialect", async () => {
  for (const mode of [
    "mismatch",
    "unreadable",
    "empty",
    "unsupported",
  ] as const) {
    let reads = 0;
    const result = await prepareDefaultConnectionFixture(async (name, data) => {
      if (name === "list-data-connections") {
        reads++;
        return {
          connections: [
            {
              ...connection,
              ...(mode === "unsupported" ? { type: "other" } : {}),
              ...(mode === "mismatch" && reads > 1
                ? { id: "connection-b" }
                : {}),
            },
          ],
        };
      }
      if (mode === "unreadable") throw new Error("catalog unavailable");
      return page(mode === "empty" ? [] : data.parentId ? [table] : [schema]);
    });
    assert.equal(result.status, "unavailable", mode);
    if (mode === "unreadable") assert.match(result.reason, /unreadable/i);
    if (mode === "empty") assert.match(result.reason, /empty/i);
  }
});

await test("rejects unsafe or unrelated catalog table identities", async () => {
  for (const id of [
    "table:project:other:table",
    "table:project:dataset:table%60injected",
  ]) {
    const result = await prepareDefaultConnectionFixture(async (name, data) => {
      if (name === "list-data-connections")
        return { connections: [connection] };
      return page(data.parentId ? [{ ...table, id }] : [schema]);
    });
    assert.equal(result.status, "unavailable");
  }
});

await test("explicit table fixture requires a connection and expected rows", () => {
  const fixture = {
    connectionId: "connection-a",
    query: "SELECT 1 AS qa_value FROM `project.dataset.table` LIMIT 1",
    expectedRows: [[1]],
  };
  assert.deepEqual(
    parseDefaultConnectionFixture(JSON.stringify(fixture)),
    fixture,
  );
  assert.throws(() =>
    parseDefaultConnectionFixture(
      JSON.stringify({ query: fixture.query, expectedRows: [[1]] }),
    ),
  );
  assert.throws(() =>
    parseDefaultConnectionFixture(
      JSON.stringify({
        connectionId: fixture.connectionId,
        query: fixture.query,
      }),
    ),
  );
  assert.throws(() =>
    parseDefaultConnectionFixture(
      JSON.stringify({ ...fixture, query: "SELECT 1 AS qa_value" }),
    ),
  );
  assert.throws(() =>
    parseDefaultConnectionFixture(
      JSON.stringify({ ...fixture, expectedRows: [[2]] }),
    ),
  );
});

await test("checker refuses a changed default after discovery before creating a project", async () => {
  const { checkDefaultConnection } = await import("./default-connection.js");
  let reads = 0;
  let creates = 0;
  const fakePage = {
    request: {
      fetch: async (url: string, options: { method: string }) => {
        if (options.method !== "GET") {
          creates++;
          throw new Error("Project creation must not occur");
        }
        const parsed = new URL(url);
        let payload: unknown;
        if (parsed.pathname.endsWith("/list-data-connections")) {
          reads++;
          payload = {
            connections: [
              {
                ...connection,
                id: reads === 1 ? connection.id : "connection-b",
              },
            ],
          };
        } else if (parsed.pathname.endsWith("/list-connection-datasets")) {
          payload = page(
            parsed.searchParams.has("parentId") ? [table] : [schema],
          );
        } else throw new Error(`Unexpected GET ${parsed.pathname}`);
        return { ok: () => true, status: () => 200, json: async () => payload };
      },
    },
  };
  const result = await checkDefaultConnection(
    fakePage as unknown as import("@playwright/test").Page,
    "http://localhost",
    undefined,
  );
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /no longer matches/);
  assert.equal(reads, 2);
  assert.equal(creates, 0);
});

await test("discovers an eligible table on a later catalog page", async () => {
  const cursors: unknown[] = [];
  const result = await prepareDefaultConnectionFixture(async (name, data) => {
    if (name === "list-data-connections") return { connections: [connection] };
    if (!data.parentId) return page([schema]);
    cursors.push(data.after);
    return data.after
      ? page([table])
      : { items: [], endCursor: "next", hasNextPage: true };
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(cursors, [undefined, "next"]);
});

await test("rejects a looping table cursor without creating a fixture", async () => {
  let calls = 0;
  const result = await prepareDefaultConnectionFixture(async (name, data) => {
    if (name === "list-data-connections") return { connections: [connection] };
    if (!data.parentId) return page([schema]);
    calls++;
    return { items: [], endCursor: "same", hasNextPage: true };
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /cursor/i);
  assert.equal(calls, 2);
});

await test("matches action responses under the hosted app prefix", async () => {
  const { actionPath } = await import("./default-connection.js");
  assert.equal(
    actionPath("https://example.test/analytics-2/", "start-notebook-run"),
    "/analytics-2/_agent-native/actions/start-notebook-run",
  );
  assert.equal(
    actionPath("http://localhost:8105", "decide-notebook-pending-changes"),
    "/_agent-native/actions/decide-notebook-pending-changes",
  );
});
