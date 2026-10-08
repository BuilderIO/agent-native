import { beforeEach, describe, expect, it, vi } from "vitest";

import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "../agent/engine/credential-errors.js";

const state = vi.hoisted(() => ({ status: 0, hasGoogleSecret: true }));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: () => "POST",
  readBody: async () => ({}),
  setResponseStatus: (_event: unknown, status: number) => {
    state.status = status;
  },
}));

vi.mock("./request-origin.js", () => ({ isSameOriginRequest: () => true }));
vi.mock("./auth.js", () => ({
  getSession: async () => ({ email: "visitor@example.com" }),
}));
vi.mock("../org/context.js", () => ({
  getOrgContext: async () => null,
  resolveOrgIdForEmail: async () => null,
}));
vi.mock("../credentials/index.js", () => ({
  resolveCredential: async () => undefined,
}));
vi.mock("../secrets/storage.js", () => ({
  readAppSecret: async ({ key }: { key: string }) =>
    key === "GOOGLE_APPLICATION_CREDENTIALS" && state.hasGoogleSecret
      ? { key, value: '{"type":"service_account"}' }
      : null,
  readAppSecrets: async () => new Map(),
  writeAppSecret: async () => undefined,
  deleteAppSecret: async () => undefined,
}));

const resolveBuilderGatewayAuth = vi.hoisted(() => vi.fn());
vi.mock("./credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credential-provider.js")>()),
  resolveBuilderGatewayAuth: (...args: unknown[]) =>
    resolveBuilderGatewayAuth(...args),
}));

const { createGoogleRealtimeSessionHandler } =
  await import("./google-realtime-session.js");

async function post() {
  const handler = createGoogleRealtimeSessionHandler() as unknown as (
    event: unknown,
  ) => Promise<{ error?: string }>;
  return handler({});
}

describe("google realtime session credential gate", () => {
  beforeEach(() => {
    state.status = 0;
    state.hasGoogleSecret = true;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.BUILDER_GATEWAY_TOKEN;
    delete process.env.FUSION_ENVIRONMENT;
    delete process.env.FUSION_ENV_ORIGIN;
    delete process.env.VITE_FUSION_ENV_ORIGIN;
    resolveBuilderGatewayAuth.mockReset();
    resolveBuilderGatewayAuth.mockResolvedValue(null);
  });

  it("gives a visitor the one line when the credits lane cannot mint a session", async () => {
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";

    await expect(post()).resolves.toEqual({
      error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    });
    expect(state.status).toBe(400);
  });

  it("keeps the diagnosable copy for an owner with no credits lane", async () => {
    const result = await post();

    expect(result.error).toContain("Builder must be connected");
    expect(state.status).toBe(400);
  });

  it("does not use a deployment Google credential in a hosted preview", async () => {
    state.hasGoogleSecret = false;
    process.env.FUSION_ENVIRONMENT = "preview";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '{"type":"service_account"}';

    const result = await post();

    expect(result.error).toContain("Configure GOOGLE_APPLICATION_CREDENTIALS");
    expect(state.status).toBe(400);
  });

  describe("with the credits lane connected", () => {
    beforeEach(() => {
      resolveBuilderGatewayAuth.mockResolvedValue({
        authorization: "Bearer btk-site-token",
        spaceId: "space-1",
        userId: null,
      });
    });

    it("hides the gateway's rejection behind the one visitor line", async () => {
      process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: "credits exhausted" }, { status: 402 }),
        ),
      );

      await expect(post()).resolves.toEqual({
        error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
      });
      expect(state.status).toBe(402);
    });

    it("keeps the gateway's reason for an owner off a credits deployment", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: "gateway_not_enabled" }, { status: 403 }),
        ),
      );

      const result = await post();
      expect(result.error).toBe("gateway_not_enabled");
      expect(state.status).toBe(403);
    });
  });
});
