import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  credential: vi.fn(),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp: state.credential,
}));
import * as modelImpl from "./data-dbt.js";
import * as libImpl from "../lib/warehouse-dbt.js";

const config = {
  hasDbtMetadata: true,
  dbtCloudHostname: "cloud.getdbt.com",
  dbtEnvironmentId: "42",
};
const legacy = {
  ...config,
  dbtVersion: "legacy",
  dbtAccountId: "7",
  dbtProjectId: "11",
};
const table = {
  projectId: "qa-project",
  datasetId: "analytics",
  tableId: "customers",
};
const node = {
  uniqueId: "model.qa.customers",
  name: "customers",
  description: "Customer documentation",
  database: "qa-project",
  schema: "analytics",
  alias: "customers",
  runId: 57,
  columns: [],
  tests: [],
};
const forbiddenJob = (id: number) => ({
  errors: [
    {
      message:
        "The token provided does not authorize you to perform the given query.",
      locations: [{ line: 1, column: 28 }],
      path: ["job"],
      extensions: { code: "FORBIDDEN", id, idType: "jobId" },
    },
  ],
  data: { job: null },
});
const noDataJob = (id: number) => ({
  errors: [
    {
      message: "There is no data available for this input.",
      path: ["job"],
      extensions: { code: "NO_DATA_AVAILABLE", id, idType: "jobId" },
    },
  ],
  data: { job: null },
});
const environmentError = (code: string, message: string) => ({
  errors: [
    {
      message,
      path: ["environment"],
      extensions: { code, id: 42, idType: "envId" },
    },
  ],
  data: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const jobList = (...ids: number[]) =>
  json({
    data: ids.map((id) => ({
      id,
      project_id: 11,
      environment_id: 42,
      generate_docs: true,
    })),
  });
function discovery(byJob: (jobId: string) => unknown) {
  state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.includes("/api/")) return jobList(1, 2);
    const args = JSON.parse(String(init.body));
    return json(byJob(args.variables.jobId));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.credential.mockResolvedValue({
    available: true,
    value: "fixture service credential",
  });
});

describe.each([
  ["connection save path", modelImpl],
  ["connection test path", libImpl],
])("dbt Discovery error envelopes: %s", (_name, impl) => {
  const connection = {
    id: "qa-connection",
    config: { ...legacy, dbtCredentialKey: "QA_DBT_CREDENTIAL" },
    credentialRefs: [{ key: "QA_DBT_CREDENTIAL" }],
  };

  it("validates a legacy project when an earlier docs job is unreadable to the token", async () => {
    discovery((jobId) =>
      jobId === "1" ? forbiddenJob(1) : { data: { job: { models: [] } } },
    );
    await expect(
      impl.validateDbtConfiguration(legacy, "fixture service credential"),
    ).resolves.toBeUndefined();
  });

  it("validates a legacy project when an earlier docs job has never run", async () => {
    discovery((jobId) =>
      jobId === "1" ? noDataJob(1) : { data: { job: { models: [] } } },
    );
    await expect(
      impl.validateDbtConfiguration(legacy, "fixture service credential"),
    ).resolves.toBeUndefined();
  });

  it("reports a token that cannot read any docs job as a permission problem", async () => {
    discovery((jobId) => forbiddenJob(Number(jobId)));
    await expect(
      impl.validateDbtConfiguration(legacy, "fixture service credential"),
    ).rejects.toMatchObject({ errorCode: "data_dbt_access_denied" });
  });

  it("reads legacy table metadata from a later docs job after an unreadable one", async () => {
    discovery((jobId) =>
      jobId === "1" ? forbiddenJob(1) : { data: { job: { models: [node] } } },
    );
    expect(await impl.readDbtTableMetadata(connection, table)).toMatchObject({
      uniqueId: "model.qa.customers",
    });
  });

  it("reports a token that cannot read the environment as a permission problem", async () => {
    state.fetch.mockResolvedValue(
      json(
        environmentError(
          "FORBIDDEN",
          "The token provided does not authorize you to perform the given query.",
        ),
      ),
    );
    await expect(
      impl.validateDbtConfiguration(
        { ...config, dbtVersion: "current" },
        "fixture service credential",
      ),
    ).rejects.toMatchObject({ errorCode: "data_dbt_access_denied" });
  });

  it("names an environment with no applied data instead of a generic failure", async () => {
    state.fetch.mockResolvedValue(
      json(
        environmentError(
          "NO_DATA_AVAILABLE",
          "There is no data available for this input.",
        ),
      ),
    );
    await expect(
      impl.validateDbtConfiguration(
        { ...config, dbtVersion: "current" },
        "fixture service credential",
      ),
    ).rejects.toMatchObject({
      errorCode: "data_dbt_configuration_invalid",
      message: expect.stringContaining("Environment ID"),
    });
  });

  it("still treats an unrecognized GraphQL error as a provider failure", async () => {
    state.fetch.mockResolvedValue(
      json({
        errors: [{ message: "Internal error", extensions: { code: "OTHER" } }],
        data: null,
      }),
    );
    await expect(
      impl.validateDbtConfiguration(
        { ...config, dbtVersion: "current" },
        "fixture service credential",
      ),
    ).rejects.toMatchObject({ errorCode: "data_dbt_metadata_failed" });
  });
});
