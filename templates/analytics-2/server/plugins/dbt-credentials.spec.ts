import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerRequiredSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  registerRequiredSecret: mocks.registerRequiredSecret,
}));

const plugin = await import("./dbt-credentials.js");

describe("Analytics 2 dbt credential registration", () => {
  it("registers one optional organization-scoped API key for the dbt token", () => {
    expect(plugin.DBT_SERVICE_TOKEN_KEY).toBe(
      "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
    );
    const registrations = mocks.registerRequiredSecret.mock.calls.map(
      ([secret]) => secret,
    );
    expect(registrations.length).toBeGreaterThanOrEqual(1);
    for (const secret of registrations) {
      expect(secret).toMatchObject({
        key: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
        scope: "org",
        kind: "api-key",
        required: false,
        usedFor: [
          expect.objectContaining({
            appId: "analytics-2",
            feature: "dbt metadata requests",
          }),
        ],
      });
    }
    expect(JSON.stringify(registrations)).not.toMatch(/value|secret:/i);
  });

  it("ships a default export for the Nitro plugin loader", () => {
    expect(typeof plugin.default).toBe("function");
    mocks.registerRequiredSecret.mockClear();
    plugin.default();
    expect(mocks.registerRequiredSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
        required: false,
      }),
    );
  });
});
