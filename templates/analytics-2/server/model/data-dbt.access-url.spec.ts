import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));
import { validateDbtConfiguration } from "./data-dbt.js";
import cases from "./fixtures/dbt-access-urls.json";

beforeEach(() => {
  state.fetch.mockReset().mockImplementation(async () =>
    Response.json({
      data: { environment: { applied: { models: { edges: [] } } } },
    }),
  );
});

const validate = (host: string) =>
  validateDbtConfiguration(
    {
      hasDbtMetadata: true,
      dbtVersion: "current",
      dbtCloudHostname: host,
      dbtEnvironmentId: "42",
    },
    "flagged-integration-credential",
  );

it.each(cases)(
  "validates a supported Access URL $input at its Discovery endpoint",
  async ({ input, expected }) => {
    await validate(input);
    expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
      expected.metadata,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token flagged-integration-credential",
        }),
      }),
      expect.objectContaining({ httpsOnly: true, followRedirects: false }),
    );
  },
);

it.each([
  "http://metadata.cloud.getdbt.com",
  "https://metadata.cloud.getdbt.com@evil.invalid",
  "https://metadata.cloud.getdbt.com.evil.invalid",
  "https://metadata.cloud.getdbt.com:444",
  "https://owner:password@metadata.cloud.getdbt.com",
  "https://metadata.cloud.getdbt.com/path",
  "https://metadata.cloud.getdbt.com/?redirect=evil.invalid",
  "https://metadata.cloud.getdbt.com/#fragment",
  "metadata.metadata.cloud.getdbt.com",
  "semantic-layer.metadata.cloud.getdbt.com",
  "qa-account.metadata.semantic-layer.us1.dbt.com",
  "cloud..getdbt.com",
  "cloud.-tenant.getdbt.com",
  "cloud.tenant-.getdbt.com",
  "cloud.tenant.getdbt.com.evil.invalid",
  "127.0.0.1",
  "localhost",
])("rejects unsafe Access URL %s before provider dispatch", async (input) => {
  await expect(validate(input)).rejects.toThrow("Access URL");
  expect(state.fetch).not.toHaveBeenCalled();
});

it.each(["us5", "au2"])(
  "preserves existing supported account region %s",
  async (region) => {
    await validate(`qa-account.${region}.dbt.com`);
    expect(state.fetch.mock.calls[0]?.[0]).toBe(
      `https://qa-account.metadata.${region}.dbt.com/graphql`,
    );
  },
);

it("normalizes a full HTTPS API URL without retaining its prefix twice", async () => {
  await validate("  https://QA-ACCOUNT.SEMANTIC-LAYER.US1.DBT.COM/  ");
  expect(state.fetch.mock.calls[0]?.[0]).toBe(
    "https://qa-account.metadata.us1.dbt.com/graphql",
  );
});

it.each([
  [
    "https://metadata.cloud.getdbt.com/graphql",
    "https://metadata.cloud.getdbt.com/graphql",
  ],
  [
    "metadata.cloud.getdbt.com/graphql/",
    "https://metadata.cloud.getdbt.com/graphql",
  ],
  [
    "https://qa-account.metadata.us1.dbt.com/graphql",
    "https://qa-account.metadata.us1.dbt.com/graphql",
  ],
  [
    "https://metadata.cloud.qa-tenant.getdbt.com/graphql",
    "https://metadata.cloud.qa-tenant.getdbt.com/graphql",
  ],
  [
    "https://semantic-layer.cloud.getdbt.com/api/graphql",
    "https://metadata.cloud.getdbt.com/graphql",
  ],
  [
    "https://qa-account.semantic-layer.us1.dbt.com/api/graphql",
    "https://qa-account.metadata.us1.dbt.com/graphql",
  ],
])(
  "accepts copied dbt API endpoint URL %s and resolves %s",
  async (input, expected) => {
    await validate(input);
    expect(state.fetch.mock.calls[0]?.[0]).toBe(expected);
  },
);

it.each([
  "https://cloud.getdbt.com/graphql",
  "https://metadata.cloud.getdbt.com/api/graphql",
  "https://metadata.cloud.getdbt.com/graphql/extra",
  "https://semantic-layer.cloud.getdbt.com/graphql",
])("rejects mismatched dbt API pathname %s", async (input) => {
  await expect(validate(input)).rejects.toThrow("Access URL");
  expect(state.fetch).not.toHaveBeenCalled();
});
