import { fail } from "@agent-native/core/action";
import {
  createProviderApiRuntime,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { runWithRequestContext } from "@agent-native/core/server";
import { expect, it, vi } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import type { BigQuerySource } from "./source-resolver.js";
import { bigQueryLocation, prepareBigQuery } from "./sql-adapter.js";
import { withWarehouseSource } from "./warehouse-connector.js";

const authority = vi.hoisted(() => ({
  granted: false,
  runtime: undefined as BigQuerySource["runtime"] | undefined,
}));

vi.mock("../lib/org-bigquery-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../lib/org-bigquery-credentials.js")
  >()),
  requireOrganizationBigQueryAuthority: async () => {
    if (!authority.granted)
      fail("Source grant removed.", {
        statusCode: 403,
        errorCode: "bigquery_grant_denied",
      });
    return { projectId: "regional-fixture", revision: "1" };
  },
  withOrganizationBigQueryRequestContext: async (
    _scope: unknown,
    run: () => Promise<unknown>,
  ) => run(),
}));

const connected = vi.hoisted(() => ({
  runtime: undefined as BigQuerySource["runtime"] | undefined,
}));

vi.mock("../model/data-connections.js", () => ({
  isBuiltinSampleConnection: () => false,
  readDataConnection: async () => ({ provider: "bigquery" }),
  resolveNotebookWarehouseConnection: async () => {
    if (!connected.runtime) throw new Error("The provider fixture is missing");
    return {
      projectId: "connected-fixture",
      location: "US",
      runtime: connected.runtime,
      storage: null,
      revision: ["1"],
    };
  },
}));

vi.mock("../lib/provider-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/provider-api.js")>()),
  getAnalytics2OrganizationQueryProviderApiRuntime: () => {
    if (!authority.runtime) throw new Error("The provider fixture is missing");
    return authority.runtime;
  },
}));

function validated(
  projectId: string,
  location: string,
  statementType = "SELECT",
) {
  return {
    response: {
      ok: true,
      status: 200,
      truncated: false,
      json: {
        jobReference: { projectId, location },
        statistics: { query: { statementType } },
      },
    },
  };
}

function queryFrom(request: ProviderApiRequestArgs) {
  expect(request.method).toBe("POST");
  const body = request.body as {
    configuration: {
      dryRun: boolean;
      query: {
        query: string;
        defaultDataset?: { projectId: string; datasetId: string };
      };
    };
  };
  expect(body.configuration.dryRun).toBe(true);
  return body.configuration.query;
}

it("routes same-named BigQuery tables to the warehouse's inferred regions and surfaces its cross-region rejection", async () => {
  const locations = [
    ["orders_us", "US"],
    ["orders_east", "us-east1"],
  ] as const;
  const queries = locations.map(
    ([schema]) =>
      `select * from \`regional-fixture.${schema}.customers\` limit 100`,
  );
  // raw-sql-ok: fixed test query
  const mixed = queries.join(" union all ");
  const message =
    "Not found: Dataset regional-fixture:orders_east was not found in location US";
  const request = vi.fn(async (args: ProviderApiRequestArgs) => {
    const sql = queryFrom(args).query;
    if (sql === mixed) {
      return {
        response: {
          ok: false,
          status: 404,
          truncated: false,
          json: {
            error: {
              message,
              errors: [{ reason: "notFound" }],
            },
          },
        },
      };
    }
    const match = locations[queries.indexOf(sql)];
    if (!match) throw new Error("Unexpected dry run");
    return validated("regional-fixture", match[1]);
  });
  const source: BigQuerySource = {
    projectId: "regional-fixture",
    generation: "42",
    location: "US",
    storage: null,
    runtime: {
      ...createProviderApiRuntime({ appId: "warehouse-region-fixture" }),
      executeRequest: request,
    },
  };
  for (const [index, [, location]] of locations.entries()) {
    const sql = queries[index];
    if (!sql) throw new Error("Missing fixture query");
    // raw-sql-ok: fixed test query
    const compiled = { sql, parameters: [] };
    const verified = await bigQueryLocation(source, compiled, "reuse");
    expect(
      prepareBigQuery(
        { ...source, location: verified },
        compiled,
        "catalog-intent",
        "reuse",
      ).job.location,
    ).toBe(location);
  }
  // oracle-change: The original renders the warehouse traceback for a database error (ce1a51bf2375.js:556,740–745).
  await expect(
    bigQueryLocation(source, { sql: mixed, parameters: [] }, "reuse"),
  ).rejects.toMatchObject({ provider: { reason: "notFound", message } });
  expect(
    request.mock.calls.map(([args]) => [args.path, queryFrom(args).query]),
  ).toEqual(
    [...queries, mixed].map((sql) => ["/projects/regional-fixture/jobs", sql]),
  );
});

it("rechecks the organization grant before dispatching or recovering a prepared warehouse job", async () => {
  const actor = {
    orgId: "warehouse-region-workspace",
    ownerEmail: "owner@example.test",
    caller: "frontend",
  };
  const executeRequest = vi.fn(async (args: ProviderApiRequestArgs) => {
    expect(queryFrom(args).query).toBe("select 42");
    return validated("regional-fixture", "US");
  });
  authority.runtime = {
    ...createProviderApiRuntime({ appId: "warehouse-authority-fixture" }),
    executeRequest,
  };
  authority.granted = true;
  await runWithRequestContext(
    { orgId: actor.orgId, userEmail: actor.ownerEmail },
    () =>
      withWarehouseSource(
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        actor,
        async (source) => {
          if (source.kind !== "bigquery") throw new Error("Expected BigQuery");
          const operation = await source.prepare(
            source.compile("select 42", new Map()),
            "prepared-job",
            "reuse",
          );
          authority.granted = false;
          await expect(operation.start(true)).rejects.toMatchObject({
            statusCode: 403,
            errorCode: "bigquery_grant_denied",
          });
          expect(executeRequest).toHaveBeenCalledTimes(1);
        },
      ),
  );
});

it("binds an unqualified table to the selected BigQuery dataset and its own region", async () => {
  const executeRequest = vi.fn(async (args: ProviderApiRequestArgs) => {
    const dataset = queryFrom(args).defaultDataset;
    expect(dataset?.projectId).toBe("regional-fixture");
    return validated(
      "regional-fixture",
      dataset?.datasetId === "new_orders" ? "us-east1" : "US",
    );
  });
  const source: BigQuerySource = {
    projectId: "regional-fixture",
    generation: "42",
    location: "US",
    storage: null,
    runtime: {
      ...createProviderApiRuntime({ appId: "warehouse-default-dataset" }),
      executeRequest,
    },
  };
  const sql =
    "with selected as (select sentinel from orders) select * from selected";
  const prepare = async (datasetId: string) => {
    const selected = { ...source, defaultDatasetId: datasetId };
    // raw-sql-ok: fixed test query
    const location = await bigQueryLocation(
      selected,
      { sql, parameters: [] },
      "reuse",
    );
    return prepareBigQuery(
      { ...selected, location },
      { sql, parameters: [] },
      "source-switch",
      "reuse",
    );
  };
  const previous = await prepare("old_orders");
  const next = await prepare("new_orders");

  expect(next.config).toMatchObject({
    query: sql,
    defaultDataset: { projectId: "regional-fixture", datasetId: "new_orders" },
  });
  expect(previous.config).toMatchObject({
    query: sql,
    defaultDataset: { projectId: "regional-fixture", datasetId: "old_orders" },
  });
  expect(previous.job.location).toBe("US");
  expect(next.job.location).toBe("us-east1");
  expect(next.job.jobId).not.toBe(previous.job.jobId);
  expect(
    executeRequest.mock.calls.map(([args]) => [
      args.path,
      queryFrom(args).defaultDataset?.datasetId,
    ]),
  ).toEqual([
    ["/projects/regional-fixture/jobs", "old_orders"],
    ["/projects/regional-fixture/jobs", "new_orders"],
  ]);
});

it("prepares a connected BigQuery UNNEST query and resolves the dataset its subquery reads", async () => {
  const actor = {
    orgId: "warehouse-unnest-workspace",
    ownerEmail: "owner@example.test",
    caller: "frontend",
  };
  const executeRequest = vi.fn(async (args: ProviderApiRequestArgs) =>
    validated(
      "connected-fixture",
      queryFrom(args).query === nested ? "us-east1" : "US",
    ),
  );
  connected.runtime = {
    ...createProviderApiRuntime({ appId: "warehouse-unnest-fixture" }),
    executeRequest,
  };
  const generated =
    "select id, if(id = 75, 126, 0) as amount from unnest(generate_array(1, 75)) as id order by id";
  const nested =
    "select id from UNNEST((select array_agg(id) from `connected-fixture.east.ids`)) as id";
  const prepared = await runWithRequestContext(
    { orgId: actor.orgId, userEmail: actor.ownerEmail },
    () =>
      withWarehouseSource("connected-bigquery", actor, async (source) => {
        if (source.kind !== "bigquery") throw new Error("Expected BigQuery");
        return Promise.all(
          [generated, nested].map((sql) =>
            source.prepare(
              source.compile(sql, new Map()),
              "unnest-intent",
              "reuse",
            ),
          ),
        );
      }),
  );
  expect(
    prepared.map(({ config, job }) => [config.query, job.location]),
  ).toEqual([
    [generated, "US"],
    [nested, "us-east1"],
  ]);
  expect(
    executeRequest.mock.calls.map(([args]) => [
      args.path,
      queryFrom(args).query,
    ]),
  ).toEqual([
    ["/projects/connected-fixture/jobs", generated],
    ["/projects/connected-fixture/jobs", nested],
  ]);
});

it("passes a bare table to BigQuery and retains the warehouse's validation error", async () => {
  const actor = {
    orgId: "warehouse-validation-workspace",
    ownerEmail: "owner@example.test",
    caller: "frontend",
  };
  const query = "select * from table";
  const message =
    'Table "table" must be qualified with a dataset (e.g. dataset.table).';
  const executeRequest = vi.fn(async () => ({
    response: {
      ok: false,
      status: 400,
      truncated: false,
      json: { error: { message, errors: [{ reason: "invalid", message }] } },
    },
  }));
  connected.runtime = {
    ...createProviderApiRuntime({ appId: "warehouse-validation-fixture" }),
    executeRequest,
  };
  await runWithRequestContext(
    { orgId: actor.orgId, userEmail: actor.ownerEmail },
    () =>
      withWarehouseSource("connected-bigquery", actor, async (source) => {
        if (source.kind !== "bigquery") throw new Error("Expected BigQuery");
        await expect(
          source.prepare(
            source.compile(query, new Map()),
            "bare-table",
            "reuse",
          ),
        ).rejects.toMatchObject({
          provider: { reason: "invalid", message },
        });
      }),
  );
  expect(executeRequest).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      method: "POST",
      path: "/projects/connected-fixture/jobs",
      body: expect.objectContaining({
        configuration: {
          dryRun: true,
          query: expect.objectContaining({ query, useLegacySql: false }),
        },
      }),
    }),
  );
});

it.each(["DELETE", "EXPORT_DATA", "SCRIPT"])(
  "refuses a BigQuery %s without dispatching it on the organization connection",
  async (statementType) => {
    const actor = {
      orgId: "warehouse-policy-workspace",
      ownerEmail: "owner@example.test",
      caller: "frontend",
    };
    const executeRequest = vi.fn(async (args: ProviderApiRequestArgs) => {
      expect(queryFrom(args)).toMatchObject({
        maximumBytesBilled: "50000000000",
      });
      return validated("regional-fixture", "US", statementType);
    });
    authority.granted = true;
    authority.runtime = {
      ...createProviderApiRuntime({ appId: "warehouse-policy-fixture" }),
      executeRequest,
    };
    await runWithRequestContext(
      { orgId: actor.orgId, userEmail: actor.ownerEmail },
      () =>
        withWarehouseSource(
          ORGANIZATION_BIGQUERY_SOURCE_ID,
          actor,
          async (source) => {
            if (source.kind !== "bigquery")
              throw new Error("Expected BigQuery");
            const sql = {
              DELETE:
                "delete from regional-fixture.orders_us.customers where true",
              EXPORT_DATA:
                "export data options(uri='gs://fixture/*.csv',format='CSV') as select 1",
              SCRIPT: "select 1; select 2",
            }[statementType];
            if (!sql) throw new Error("Missing fixture query");
            await expect(
              source.prepare(
                source.compile(sql, new Map()),
                "read-only",
                "reuse",
              ),
            ).rejects.toMatchObject({
              errorCode: "bigquery_read_only_query_required",
            });
          },
        ),
    );
    expect(executeRequest).toHaveBeenCalledTimes(1);
  },
);
