import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registerRequiredSecret: vi.fn() }));
vi.mock("@agent-native/core/secrets", () => ({
  registerRequiredSecret: mocks.registerRequiredSecret,
}));

const plugin = await import("./hubspot-credentials.js");

const reply =
  (status: number, body = "") =>
  async () => ({
    status,
    text: async () => body,
  });

describe("HubSpot MCP credential registration", () => {
  it("registers the labelled client ID and secret as workspace keys", () => {
    const byKey = Object.fromEntries(
      mocks.registerRequiredSecret.mock.calls.map(([s]) => [s.key, s]),
    );
    expect(byKey.HUBSPOT_MCP_CLIENT_ID).toMatchObject({
      label: "HubSpot MCP OAuth client ID",
      scope: "workspace",
    });
    expect(byKey.HUBSPOT_MCP_CLIENT_SECRET).toMatchObject({
      label: "HubSpot MCP OAuth client secret",
      scope: "workspace",
    });
    expect(typeof byKey.HUBSPOT_MCP_CLIENT_ID.validator).toBe("function");
  });
});

describe("HubSpot client ID test", () => {
  it("maps a recognised client to connected", async () => {
    await expect(
      plugin.testHubSpotClientId(
        "fake-id",
        reply(400, '{"status":"BAD_AUTH_CODE"}'),
      ),
    ).resolves.toEqual({ kind: "connected" });
  });
  it("maps a rejected client to auth_failed", async () => {
    await expect(
      plugin.testHubSpotClientId(
        "fake-id",
        reply(400, '{"status":"BAD_CLIENT_ID"}'),
      ),
    ).resolves.toMatchObject({ kind: "auth_failed" });
    await expect(
      plugin.testHubSpotClientId("fake-id", reply(401)),
    ).resolves.toMatchObject({ kind: "auth_failed" });
    await expect(plugin.testHubSpotClientId("  ")).resolves.toMatchObject({
      kind: "auth_failed",
    });
  });
  it("maps network errors, 5xx, 429 and unexpected statuses to unreachable", async () => {
    const boom = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      plugin.testHubSpotClientId("fake-id", boom),
    ).resolves.toMatchObject({
      kind: "unreachable",
    });
    for (const status of [500, 503, 429, 200, 404]) {
      await expect(
        plugin.testHubSpotClientId("fake-id", reply(status)),
      ).resolves.toMatchObject({ kind: "unreachable" });
    }
  });
  it("surfaces typed failures through the validator and never as ok", async () => {
    await expect(
      plugin.validateHubSpotClientId("fake-id", reply(400)),
    ).resolves.toEqual({ ok: true });
    await expect(
      plugin.validateHubSpotClientId("fake-id", reply(401)),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/^Auth failed:/),
    });
    await expect(
      plugin.validateHubSpotClientId("fake-id", reply(502)),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/^Unreachable:/),
    });
  });
});
