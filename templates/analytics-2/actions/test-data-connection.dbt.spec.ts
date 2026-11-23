import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  validateKey: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));
vi.mock("../server/model/data-connections.js", () => ({
  manager: vi.fn(async () => undefined),
  resolveSavedBigQueryTestCredentials: vi.fn(
    async (
      _connectionId: string,
      options: { resolveServiceAccount: boolean; resolveDbtToken: boolean },
    ) => ({
      runtime: options.resolveServiceAccount ? ({} as never) : undefined,
      dbtToken: options.resolveDbtToken ? "saved-dbt-token" : undefined,
    }),
  ),
}));
vi.mock("../server/model/data-connection-provider.js", () => ({
  bigQueryMetadataRejection: () => undefined,
  validateBigQueryProjectAccess: state.validateKey,
  validateConfiguredBigQueryDatasets: vi.fn(),
  validateConfiguredBigQueryDatasetsWithRuntime: vi.fn(),
  validateSubmittedServiceAccount: state.validateKey,
}));
import testDataConnection from "./test-data-connection";

const base = {
  projectId: "example-project",
  serviceAccount: "{}",
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtCloudHostname: "cloud.getdbt.com",
  dbtEnvironmentId: "42",
  dbtToken: "fake-service-token",
};
function graphql(json: unknown, status = 200) {
  return new Response(JSON.stringify({ data: json }), { status });
}
async function run(input: Record<string, unknown>) {
  return testDataConnection.run(input as never, { caller: "frontend" });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.validateKey.mockResolvedValue(undefined);
});

describe("testing the dbt half of a BigQuery connection form", () => {
  it("verifies the environment with the submitted token and reports success", async () => {
    state.fetch.mockResolvedValue(
      graphql({ environment: { applied: { models: { edges: [] } } } }),
    );
    await expect(run(base)).resolves.toEqual({ verified: true });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = state.fetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://metadata.cloud.getdbt.com/graphql");
    expect(init.headers.Authorization).toBe("Token fake-service-token");
  });

  it("does not call dbt when the integration is off", async () => {
    await expect(run({ ...base, hasDbtMetadata: false })).resolves.toEqual({
      verified: true,
    });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("does not call dbt when the BigQuery key was refused", async () => {
    state.validateKey.mockRejectedValue(new Error("refused"));
    await expect(run(base)).rejects.toMatchObject({
      errorCode: "bigquery_test_unavailable",
    });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ dbtToken: "" }, "data_dbt_configuration_invalid"],
    [{ dbtEnvironmentId: "not-a-number" }, "data_dbt_configuration_invalid"],
    [
      { dbtCloudHostname: "evil.example.invalid" },
      "data_dbt_configuration_invalid",
    ],
  ])(
    "rejects %j with a typed dbt error and no request",
    async (patch, code) => {
      await expect(run({ ...base, ...patch })).rejects.toMatchObject({
        errorCode: code,
        statusCode: 422,
      });
      expect(state.fetch).not.toHaveBeenCalled();
    },
  );

  it("surfaces a refused dbt token as a typed access error", async () => {
    state.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(run(base)).rejects.toMatchObject({
      errorCode: "data_dbt_access_denied",
      statusCode: 401,
    });
  });

  it("tests an existing saved BigQuery connection with its stored dbt token when credentials are omitted", async () => {
    state.fetch.mockResolvedValue(
      graphql({ environment: { applied: { models: { edges: [] } } } }),
    );
    const { serviceAccount: _sa, dbtToken: _tok, ...withoutSecrets } = base;
    await expect(
      run({ ...withoutSecrets, connectionId: "bq-saved-dbt" }),
    ).resolves.toEqual({ verified: true });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const [, init] = state.fetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBe("Token saved-dbt-token");
  });
});
