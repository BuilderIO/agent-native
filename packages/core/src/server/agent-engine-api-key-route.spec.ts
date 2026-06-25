import type { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockGetOrgContext = vi.fn();

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: vi.fn(),
}));

import {
  normalizeAgentEngineApiKeyPayload,
  resolveAgentEngineApiKeyWriteTarget,
} from "./agent-engine-api-key-route.js";

describe("agent engine api-key route helpers", () => {
  it("accepts provider aliases and normalizes to provider env keys", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        provider: "openai",
        apiKey: " sk-example ",
      }),
    ).toEqual({
      ok: true,
      key: "OPENAI_API_KEY",
      value: "sk-example",
      scope: "user",
    });
  });

  it("rejects arbitrary non-LLM keys", () => {
    expect(
      normalizeAgentEngineApiKeyPayload({
        key: "STRIPE_SECRET_KEY",
        value: "sk-example",
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "Unsupported agent engine provider key.",
    });
  });

  it("resolves user-scope writes to the signed-in user", async () => {
    mockGetSession.mockResolvedValue({ email: "alice@example.test" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "user"),
    ).resolves.toEqual({
      ok: true,
      target: { scope: "user", scopeId: "alice@example.test" },
    });
    expect(mockGetOrgContext).not.toHaveBeenCalled();
  });

  it("requires owner or admin role for org-scope writes", async () => {
    mockGetSession.mockResolvedValue({ email: "member@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "member" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).resolves.toEqual({
      ok: false,
      statusCode: 403,
      error: "Only organization owners and admins can set org-scoped keys",
    });
  });

  it("allows owner org-scope writes to the active org", async () => {
    mockGetSession.mockResolvedValue({ email: "owner@example.test" });
    mockGetOrgContext.mockResolvedValue({ orgId: "org-1", role: "owner" });

    await expect(
      resolveAgentEngineApiKeyWriteTarget({} as H3Event, "org"),
    ).resolves.toEqual({
      ok: true,
      target: { scope: "org", scopeId: "org-1" },
    });
  });
});
