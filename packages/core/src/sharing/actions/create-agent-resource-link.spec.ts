import { beforeEach, describe, expect, it, vi } from "vitest";

const createGrant = vi.hoisted(() => vi.fn());

vi.mock("../../server/agent-access.js", () => ({
  DEFAULT_AGENT_ACCESS_TTL_SECONDS: 7200,
  buildAgentAccessApiUrl: () => "https://app.example/context",
  buildAgentAccessUrl: () => "https://app.example/page",
  createScopedAgentAccessGrant: (...args: unknown[]) => createGrant(...args),
}));
vi.mock("../../server/app-base-path.js", () => ({
  getConfiguredAppBasePath: () => "",
}));
vi.mock("../../server/request-context.js", () => ({
  getRequestContext: () => ({ requestOrigin: "https://app.example" }),
  getRequestUserEmail: () => "owner@example.com",
}));
vi.mock("../access.js", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  resolveAccess: () => ({ resource: { id: "document:fixture" } }),
}));
vi.mock("../registry.js", () => ({
  requireShareableResource: () => ({
    displayName: "Document",
    agentReadable: {
      resourceKind: "document",
      getPagePath: () => "/p/document:fixture",
      getContextPath: () => "/api/context",
    },
  }),
}));

import action from "./create-agent-resource-link.js";

describe("create-agent-resource-link expiry", () => {
  beforeEach(() => {
    createGrant.mockReset();
    createGrant.mockReturnValue({
      token: "synthetic-token",
      expiresAt: "2026-07-16T12:00:30.000Z",
      ttlSeconds: 30,
    });
  });

  it("passes an explicitly shortened bounded lifetime to the signer", async () => {
    await action.run({
      resourceType: "document",
      resourceId: "document:fixture",
      ttlSeconds: 30,
    });

    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({ ttlSeconds: 30 }),
    );
  });

  it.each([29, 7201])(
    "rejects an out-of-range lifetime of %s seconds",
    async (ttlSeconds) => {
      await expect(
        action.run({
          resourceType: "document",
          resourceId: "document:fixture",
          ttlSeconds,
        }),
      ).rejects.toThrow();
      expect(createGrant).not.toHaveBeenCalled();
    },
  );
});
