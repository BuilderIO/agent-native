import { generateKeyPairSync } from "node:crypto";

import {
  createProviderApiRuntime,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { afterEach, expect, it, vi } from "vitest";

import { parameterCellContentsSchema } from "../../app/lib/model/contracts.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { notebookProviderDiagnostic } from "./notebook-diagnostics.js";
import { withBigQuerySource, type BigQuerySource } from "./source-resolver.js";
import {
  bigQueryAdapter,
  prepareBigQuery,
  ProviderOutcomeUnknown,
  RestartWarehouseSpool,
} from "./sql-adapter.js";
import {
  compileNotebookSql,
  inputBinding,
  SqlBindingError,
} from "./sql-compiler.js";

const boundary = vi.hoisted(() => ({
  runtime: null as BigQuerySource["runtime"] | null,
  credential: "",
  initError: Object.assign(new Error("fixture storage unavailable"), {
    code: 14,
  }),
}));

vi.mock("../lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryAuthority: async () => ({
    projectId: "fixture-project",
    revision: "fixture-revision",
  }),
  withOrganizationBigQueryRequestContext: async (
    _scope: unknown,
    run: () => unknown,
  ) => run(),
}));
vi.mock("../lib/provider-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/provider-api.js")>()),
  getAnalytics2OrganizationQueryProviderApiRuntime: () => boundary.runtime,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  resolveWorkspaceConnectionCredentialForApp: async () => ({
    available: true,
    value: boundary.credential,
  }),
}));
vi.mock("../model/data-storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/data-storage.js")>()),
  createWarehouseStorageClient: async () => {
    throw boundary.initError;
  },
}));
import { runWithRequestContext } from "@agent-native/core/server";

afterEach(() => {
  boundary.runtime = null;
});

function input(
  type: string,
  defaultValueString: string,
  options?: string[],
  optionValueType?: "number",
) {
  return inputBinding(
    parameterCellContentsSchema.parse({
      kind: "input",
      id: "input",
      name: "input",
      inputType: type,
      defaultValueString,
      options,
      optionValueType,
      label: null,
      hidden: false,
      order: "i",
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    }),
  );
}

it("binds configured numeric choices as numbers in SQL", () => {
  const options = ["42", "84.5"];
  const compiled = compileNotebookSql(
    "select {{ price }} where 5 in ({{ prices | array }})",
    new Map([
      ["price", input("DROPDOWN", "42", options, "number")],
      ["prices", input("MULTISELECT", '["42","84.5"]', options, "number")],
    ]),
    "sample",
  );
  expect(compiled.sql).toBe(
    "select CAST($1 AS bigint) where 5 in (CAST($2 AS bigint), CAST($3 AS numeric))",
  );
  expect(
    compiled.parameters.map(({ parameterValue, parameterType }) => [
      parameterValue.value,
      parameterType.type,
    ]),
  ).toEqual([
    ["42", "INT64"],
    ["42", "INT64"],
    ["84.5", "NUMERIC"],
  ]);
});

const expected = [
  {
    name: "template_0",
    parameterType: { type: "INT64" },
    parameterValue: { value: "9223372036854775807" },
  },
  {
    name: "template_1",
    parameterType: { type: "BOOL" },
    parameterValue: { value: "false" },
  },
  {
    name: "template_2",
    parameterType: { type: "DATE" },
    parameterValue: { value: "2026-11-18" },
  },
  {
    name: "template_3",
    parameterType: { type: "DATE" },
    parameterValue: { value: null },
  },
  {
    name: "template_4",
    parameterType: { type: "STRING" },
    parameterValue: { value: "North" },
  },
  {
    name: "template_5",
    parameterType: { type: "STRING" },
    parameterValue: { value: "South" },
  },
  {
    name: "template_6",
    parameterType: { type: "STRING" },
    parameterValue: { value: "'quoted'" },
  },
  {
    name: "template_7",
    parameterType: { type: "NUMERIC" },
    parameterValue: { value: "43.000000001" },
  },
];

it("binds a sql_literal value as one parameter, never as SQL text", () => {
  const hostile = "x' OR 1=1; DROP TABLE t; --";
  const compiled = compileNotebookSql(
    "select {{ borough | sql_literal }} as picked where name = {{name|sql_literal}}",
    new Map([
      ["borough", input("TEXT_INPUT", "Brooklyn")],
      ["name", input("TEXT_INPUT", hostile)],
    ]),
    "bigquery",
  );
  expect(compiled.sql).toBe(
    "select @template_0 as picked where name = @template_1",
  );
  expect(compiled.parameters.map((p) => p.parameterValue.value)).toEqual([
    "Brooklyn",
    hostile,
  ]);
});

it("refuses a sql_literal filter on a list", () => {
  expect(() =>
    compileNotebookSql(
      "select {{ regions | sql_literal }}",
      new Map([["regions", input("MULTISELECT", '["North"]', ["North"])]]),
      "bigquery",
    ),
  ).toThrow(SqlBindingError);
});

it("binds a quoted multiselect placeholder as a comma-joined string parameter", () => {
  const empty = compileNotebookSql(
    "select 1 where '{{ appFilter }}' in ('', 'all') or app in unnest(split(lower('{{ appFilter }}'), ','))",
    new Map([["appFilter", input("MULTISELECT", "[]", ["analytics", "mail"])]]),
    "bigquery",
  );
  expect(empty.sql).toBe(
    "select 1 where @template_0 in ('', 'all') or app in unnest(split(lower(@template_1), ','))",
  );
  expect(empty.parameters).toEqual([
    {
      name: "template_0",
      parameterType: { type: "STRING" },
      parameterValue: { value: "" },
    },
    {
      name: "template_1",
      parameterType: { type: "STRING" },
      parameterValue: { value: "" },
    },
  ]);

  const populated = compileNotebookSql(
    "select 1 where app in unnest(split(lower('{{ appFilter }}'), ','))",
    new Map([
      [
        "appFilter",
        input("MULTISELECT", '["analytics","mail"]', ["analytics", "mail"]),
      ],
    ]),
    "bigquery",
  );
  expect(populated.parameters).toEqual([
    {
      name: "template_0",
      parameterType: { type: "STRING" },
      parameterValue: { value: "analytics,mail" },
    },
  ]);
});

it("keeps Dataframes dates, typed nulls and lists outside the SQL source", () => {
  expect(
    compileNotebookSql(
      "select {{ since }}, {{ missing }} where region in ({{ regions | array }})",
      new Map([
        ["since", input("DATE", "2026-11-18")],
        ["missing", input("DATE", "")],
        [
          "regions",
          input("MULTISELECT", JSON.stringify(["North", "'South'"]), [
            "North",
            "'South'",
          ]),
        ],
      ]),
      "dataframes",
    ),
  ).toEqual({
    sql: "select $1, CAST($2 AS date) where region in ($3, $4)",
    parameters: [
      {
        name: "template_0",
        parameterType: { type: "DATE" },
        parameterValue: { value: "2026-11-18" },
      },
      {
        name: "template_1",
        parameterType: { type: "DATE" },
        parameterValue: { value: null },
      },
      {
        name: "template_2",
        parameterType: { type: "STRING" },
        parameterValue: { value: "North" },
      },
      {
        name: "template_3",
        parameterType: { type: "STRING" },
        parameterValue: { value: "'South'" },
      },
    ],
  });
});

function compiled() {
  return compileNotebookSql(
    "select {{ integer }}, {{ boolean }}, {{ date }}, {{ missing }}, region in ({{ list | array }}), '{{ text }}', {{ decimal }} {{?empty}}, 0{{/empty}}",
    new Map([
      ["integer", input("NUMERIC_INPUT", "9223372036854775807")],
      ["boolean", input("CHECKBOX", "false")],
      ["date", input("DATE", "2026-11-18")],
      ["missing", input("DATE", "")],
      ["list", input("MULTISELECT", '["North","South"]', ["North", "South"])],
      ["text", input("TEXT_INPUT", "'quoted'")],
      ["decimal", input("NUMERIC_INPUT", "43.000000001")],
      ["empty", input("TEXT_INPUT", "")],
    ]),
    "bigquery",
  );
}
function response(status: number, json: unknown) {
  return { response: { ok: status < 400, status, truncated: false, json } };
}
function runtime(
  executeRequest: (args: ProviderApiRequestArgs) => Promise<unknown>,
) {
  return {
    ...createProviderApiRuntime({ appId: "notebook-fixture" }),
    executeRequest,
  };
}
const actor = {
  orgId: "fixture-org",
  ownerEmail: "owner@example.test",
  caller: "frontend",
};
const key = "provider-submission-42";

it("binds exact named typed values into the organization job and fingerprints serialized intent", async () => {
  const capture = vi.fn(async (request: ProviderApiRequestArgs) => {
    const body = request.body as { jobReference: unknown };
    return response(200, {
      jobReference: body.jobReference,
      status: { state: "RUNNING" },
    });
  });
  boundary.runtime = runtime(capture);
  await withBigQuerySource(
    ORGANIZATION_BIGQUERY_SOURCE_ID,
    actor,
    async (source) => {
      const sql = compiled();
      const operation = prepareBigQuery(source, sql, key, "bypass");
      const modified = prepareBigQuery(
        source,
        { ...sql, parameters: sql.parameters.slice(1) },
        key,
        "bypass",
      );
      expect(operation.job.jobId).not.toBe(modified.job.jobId);
      await bigQueryAdapter(source, operation).start(false);
      expect(capture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method: "POST",
          path: "/projects/fixture-project/jobs",
          body: {
            jobReference: operation.job,
            configuration: {
              query: {
                query:
                  "select @template_0, @template_1, @template_2, @template_3, region in (@template_4, @template_5), @template_6, @template_7",
                maximumBytesBilled: "50000000000",
                useLegacySql: false,
                useQueryCache: false,
                parameterMode: "NAMED",
                queryParameters: expected,
              },
            },
          },
        }),
      );
    },
  );
  expect(() =>
    compileNotebookSql(
      "select {{ values | array }}",
      new Map([["values", input("MULTISELECT", "[]")]]),
      "bigquery",
    ),
  ).toThrow();
  expect(() => input("DROPDOWN", "Other", ["North"])).toThrow();
});

it.each([false, true])(
  "recovers the same native job and switches Storage to REST only for a retryable read failure (storage %s)",
  async (useStorage) => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    boundary.credential = JSON.stringify({
      client_email: "fixture@fixture-project.iam.gserviceaccount.com",
      private_key: privateKey,
      project_id: "fixture-project",
    });
    let submitted = false;
    const capture = vi.fn(async (request: ProviderApiRequestArgs) => {
      if (request.method === "POST") {
        submitted = true;
        throw new Error("lost submit acknowledgement");
      }
      if (request.path.includes("/jobs/"))
        return submitted
          ? response(200, {
              jobReference: operation.job,
              status: { state: "DONE" },
            })
          : response(404, {});
      if (request.path.includes("/queries/"))
        return response(200, {
          jobComplete: true,
          jobReference: operation.job,
          totalRows: "1",
          schema: {
            fields: [{ name: "answer", type: "INT64", mode: "NULLABLE" }],
          },
          ...(typeof request.query === "object" &&
          request.query !== null &&
          "fields" in request.query
            ? {}
            : { rows: [{ f: [{ v: "9223372036854775807" }] }] }),
        });
      throw new Error("Unexpected warehouse request");
    });
    const source: BigQuerySource = {
      projectId: "fixture-project",
      location: "EU",
      generation: "42",
      runtime: runtime(capture),
      storage: useStorage
        ? {
            connectionId: "fixture-source",
            credentialKey: "FIXTURE_CREDENTIAL",
            options: { driveAccess: false },
          }
        : null,
    };
    const operation = prepareBigQuery(source, compiled(), key, "reuse");
    const adapter = bigQueryAdapter(source, operation);
    await runWithRequestContext(
      { orgId: actor.orgId, userEmail: actor.ownerEmail },
      async () => {
        expect(await adapter.start(false)).toEqual({ state: "DONE" });
        expect(await adapter.start(true)).toEqual({ state: "DONE" });
        expect(await adapter.page({})).toMatchObject({
          jobReference: operation.job,
          rows: [["9223372036854775807"]],
          totalRows: "1",
        });
        if (useStorage) {
          let fallback: RestartWarehouseSpool | undefined;
          try {
            await adapter.spoolPage("storage", 0, null);
          } catch (error) {
            if (!(error instanceof RestartWarehouseSpool)) throw error;
            fallback = error;
          }
          expect(fallback?.diagnostic.errorCode).toBe("warehouse_query_failed");
          expect(
            fallback && notebookProviderDiagnostic(fallback.diagnostic, false),
          ).toEqual({
            reason: "grpc_14",
            message: null,
            line: null,
            column: null,
          });
          expect(await adapter.spoolPage("rest", 0, null)).toMatchObject({
            jobReference: operation.job,
            rows: [["9223372036854775807"]],
          });
        }
      },
    );
    const requests = capture.mock.calls.map(([call]) => call);
    expect(requests.filter(({ method }) => method === "POST")).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          configuration: {
            query: expect.objectContaining({
              useQueryCache: true,
              queryParameters: expected,
            }),
          },
        }),
      }),
    ]);
    const reads = requests.filter(({ path }) => path.includes("/queries/"));
    expect(reads).toHaveLength(useStorage ? 4 : 1);
    expect(reads.every(({ path }) => path.endsWith(operation.job.jobId))).toBe(
      true,
    );
    if (useStorage)
      expect(reads[1]?.query).toMatchObject({
        location: "EU",
        startIndex: "0",
      });
  },
);

it("returns typed unknown when neither the submit nor its provider probe can establish an outcome", async () => {
  const capture = vi.fn(async () => {
    throw new Error("transport unavailable");
  });
  const source: BigQuerySource = {
    projectId: "fixture-project",
    location: "EU",
    generation: "42",
    storage: null,
    runtime: runtime(capture),
  };
  const adapter = bigQueryAdapter(
    source,
    prepareBigQuery(source, compiled(), key, "reuse"),
  );
  await expect(adapter.start(false)).rejects.toBeInstanceOf(
    ProviderOutcomeUnknown,
  );
  expect(capture).toHaveBeenCalledTimes(2);
});
