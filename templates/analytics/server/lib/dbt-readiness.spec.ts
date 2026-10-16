import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasAppSecret: vi.fn(async () => true),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, options?: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/secrets", () => ({
  hasAppSecret: mocks.hasAppSecret,
}));

const { dbtProviderReadiness } = await import("./dbt-readiness");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn_dbt_1",
    provider: "dbt",
    label: "dbt Cloud",
    status: "connected",
    config: { semanticLayerEnvironmentId: "123456" },
    ...overrides,
  } as any;
}

describe("dbtProviderReadiness", () => {
  beforeEach(() => {
    mocks.hasAppSecret.mockReset();
    mocks.hasAppSecret.mockResolvedValue(true);
  });

  it("reports not_connected without looking up the token when no row is granted", async () => {
    await expect(dbtProviderReadiness([], "org_test")).resolves.toBe(
      "not_connected",
    );
    expect(mocks.hasAppSecret).not.toHaveBeenCalled();
  });

  it("is ready when a granted connected row has the org token and environment ID", async () => {
    await expect(dbtProviderReadiness([row()], "org_test")).resolves.toBe(
      "ready",
    );
    expect(mocks.hasAppSecret).toHaveBeenCalledWith({
      key: "DBT_SEMANTIC_LAYER_TOKEN",
      scope: "org",
      scopeId: "org_test",
    });
  });

  it("does not read a granted connected row with no saved token as ready", async () => {
    mocks.hasAppSecret.mockResolvedValueOnce(false);

    await expect(dbtProviderReadiness([row()], "org_test")).resolves.toBe(
      "token_missing",
    );
  });

  it("reports a rejected secret lookup as an error, not as a missing token", async () => {
    mocks.hasAppSecret.mockRejectedValueOnce(
      new Error("secrets table unavailable"),
    );

    await expect(dbtProviderReadiness([row()], "org_test")).resolves.toBe(
      "error",
    );
  });

  it("reports an unknown token as an error when there is no org to check", async () => {
    await expect(dbtProviderReadiness([row()], null)).resolves.toBe("error");
    expect(mocks.hasAppSecret).not.toHaveBeenCalled();
  });

  it("asks for a connection selection when several granted rows include a ready one", async () => {
    await expect(
      dbtProviderReadiness(
        [row({ id: "conn_dbt_2", status: "needs_reauth" }), row()],
        "org_test",
      ),
    ).resolves.toBe("connection_selection_required");
  });

  it("is ready with a single granted ready row", async () => {
    await expect(dbtProviderReadiness([row()], "org_test")).resolves.toBe(
      "ready",
    );
  });

  it("reports the first row's reason when several granted rows are none ready", async () => {
    await expect(
      dbtProviderReadiness(
        [
          row({ id: "conn_dbt_2", status: "needs_reauth" }),
          row({ status: "error" }),
        ],
        "org_test",
      ),
    ).resolves.toBe("needs_reauth");
  });

  it("reports a blank environment ID as missing, the same way the readiness function does", async () => {
    await expect(
      dbtProviderReadiness(
        [row({ config: { semanticLayerEnvironmentId: "   " } })],
        "org_test",
      ),
    ).resolves.toBe("environment_missing");
  });

  it("reports a corrupt non-string environment ID as invalid without failing the provider", async () => {
    await expect(
      dbtProviderReadiness(
        [row({ config: { semanticLayerEnvironmentId: 123456 } })],
        "org_test",
      ),
    ).resolves.toBe("environment_invalid");
  });

  it("keeps the status precedence for a corrupt row: a token problem still wins", async () => {
    mocks.hasAppSecret.mockResolvedValueOnce(false);

    await expect(
      dbtProviderReadiness(
        [row({ config: { semanticLayerEnvironmentId: 123456 } })],
        "org_test",
      ),
    ).resolves.toBe("token_missing");
  });
});
