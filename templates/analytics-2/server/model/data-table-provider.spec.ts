import { describe, expect, it } from "vitest";

import { requestTableDetails } from "./data-table-provider.js";

function field(
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
) {
  return { name, type, ...extra };
}

function response(
  overrides: {
    fields?: Record<string, unknown>[];
    type?: string;
    description?: string;
    numRows?: string;
    numBytes?: string;
    lastModifiedTime?: string;
    datasetId?: string;
    location?: string;
  } = {},
) {
  return {
    response: {
      ok: true,
      status: 200,
      json: {
        kind: "bigquery#table",
        etag: "provider-etag-not-for-output",
        selfLink: "https://provider.invalid/not-for-output",
        labels: { private: "not-for-output" },
        tableReference: {
          projectId: "qa-project",
          datasetId: overrides.datasetId ?? "qa_dataset",
          tableId: "qa_table",
        },
        type: overrides.type ?? "TABLE",
        description: overrides.description ?? "Provider table description.",
        numRows: overrides.numRows ?? "42",
        numBytes: overrides.numBytes ?? "1024",
        lastModifiedTime: overrides.lastModifiedTime ?? "1720000000000",
        location: overrides.location ?? "US",
        schema: {
          fields: overrides.fields ?? [
            field("id", "INTEGER", { mode: "REQUIRED", description: "Key" }),
            field("payload", "RECORD", {
              mode: "NULLABLE",
              description: "Nested payload",
              fields: [
                field("label", "STRING", { mode: "NULLABLE" }),
                field("items", "RECORD", {
                  mode: "REPEATED",
                  fields: [field("amount", "NUMERIC", { mode: "NULLABLE" })],
                }),
              ],
              policyTags: { names: ["not-for-output"] },
            }),
          ],
        },
        externalDataConfiguration: { sourceUris: ["not-for-output"] },
      },
    },
  };
}

function runtime(result: unknown) {
  const calls: unknown[] = [];
  return {
    calls,
    runtime: {
      executeRequest: async (args: unknown) => {
        calls.push(args);
        return result;
      },
    },
  };
}

describe("bounded table metadata provider read", () => {
  it("requests the exact table path with storage statistics and projects only public fields", async () => {
    const fake = runtime(response());
    const result = await requestTableDetails(fake.runtime as never, {
      projectId: "qa-project",
      datasetId: "qa_dataset",
      tableId: "qa_table",
    });

    expect(fake.calls).toEqual([
      expect.objectContaining({
        provider: "bigquery",
        method: "GET",
        path: "/projects/qa-project/datasets/qa_dataset/tables/qa_table",
        query: { view: "STORAGE_STATS" },
        maxBytes: 16_000_000,
        timeoutMs: 30_000,
      }),
    ]);
    expect(Object.keys(result).sort()).toEqual(
      [
        "columnCount",
        "columns",
        "datasetId",
        "description",
        "lastModifiedTime",
        "location",
        "name",
        "numBytes",
        "numRows",
        "projectId",
        "providerRevision",
        "tableId",
        "type",
      ].sort(),
    );
    expect(result).toMatchObject({
      projectId: "qa-project",
      datasetId: "qa_dataset",
      tableId: "qa_table",
      name: "qa_table",
      type: "TABLE",
      description: "Provider table description.",
      numRows: "42",
      numBytes: "1024",
      lastModifiedTime: "1720000000000",
      location: "US",
      providerRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      columnCount: 2,
    });
    expect(result.columns[0]).toEqual({
      name: "id",
      type: "INTEGER",
      mode: "REQUIRED",
      description: "Key",
      fields: [],
    });
    expect(result.columns[1]).toEqual({
      name: "payload",
      type: "RECORD",
      mode: "NULLABLE",
      description: "Nested payload",
      fields: [
        {
          name: "label",
          type: "STRING",
          mode: "NULLABLE",
          description: null,
          fields: [],
        },
        {
          name: "items",
          type: "RECORD",
          mode: "REPEATED",
          description: null,
          fields: [
            {
              name: "amount",
              type: "NUMERIC",
              mode: "NULLABLE",
              description: null,
              fields: [],
            },
          ],
        },
      ],
    });
    expect("etag" in result).toBe(false);
    expect("selfLink" in result).toBe(false);
    expect("labels" in result).toBe(false);
    expect("externalDataConfiguration" in result).toBe(false);
    expect("policyTags" in result.columns[1]!).toBe(false);
  });

  it("preserves separate regions for same-named tables in different datasets", async () => {
    const projectId = "qa-project";
    const tableId = "qa_table";
    const us = runtime(response());
    const east = runtime(
      response({ datasetId: "east_dataset", location: "us-east1" }),
    );
    const standard = await requestTableDetails(us.runtime as never, {
      projectId,
      datasetId: "qa_dataset",
      tableId,
    });
    const regional = await requestTableDetails(east.runtime as never, {
      projectId,
      datasetId: "east_dataset",
      tableId,
    });
    expect(standard).toMatchObject({
      projectId,
      tableId,
      datasetId: "qa_dataset",
      location: "US",
    });
    expect(regional).toMatchObject({
      projectId,
      tableId,
      datasetId: "east_dataset",
      location: "us-east1",
    });
  });

  it("returns every provided column and keeps the 1001st instead of applying a UI cap", async () => {
    const fields = Array.from({ length: 1001 }, (_, index) =>
      field(`column_${index + 1}`, "STRING", { mode: "NULLABLE" }),
    );
    const fake = runtime(response({ fields }));
    const result = await requestTableDetails(fake.runtime as never, {
      projectId: "qa-project",
      datasetId: "qa_dataset",
      tableId: "qa_table",
    });
    expect(result.columnCount).toBe(1001);
    expect(result.columns).toHaveLength(1001);
    expect(result.columns[1000]).toMatchObject({
      name: "column_1001",
      type: "STRING",
      mode: "NULLABLE",
    });
  });

  it("refuses an unavailable schema instead of reporting empty columns", async () => {
    const incomplete = response();
    delete (incomplete.response.json as { schema?: unknown }).schema;
    await expect(
      requestTableDetails(runtime(incomplete).runtime as never, {
        projectId: "qa-project",
        datasetId: "qa_dataset",
        tableId: "qa_table",
      }),
    ).rejects.toMatchObject({ errorCode: "data_table_bad_response" });
  });

  it("keeps a permission denial and a truncated response as explicit failures", async () => {
    await expect(
      requestTableDetails(
        runtime({
          response: { ok: false, status: 403, json: { error: "denied" } },
        }).runtime as never,
        {
          projectId: "qa-project",
          datasetId: "qa_dataset",
          tableId: "qa_table",
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_permission_denied",
      statusCode: 403,
    });

    await expect(
      requestTableDetails(
        runtime({
          response: {
            ok: true,
            status: 200,
            truncated: true,
            json: response().response.json,
          },
        }).runtime as never,
        {
          projectId: "qa-project",
          datasetId: "qa_dataset",
          tableId: "qa_table",
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "data_table_response_truncated",
      statusCode: 502,
    });
  });

  it("refuses a response for a different table", async () => {
    const different = response();
    different.response.json.tableReference.tableId = "other_table";
    await expect(
      requestTableDetails(runtime(different).runtime as never, {
        projectId: "qa-project",
        datasetId: "qa_dataset",
        tableId: "qa_table",
      }),
    ).rejects.toMatchObject({ errorCode: "data_table_bad_response" });
  });
});
