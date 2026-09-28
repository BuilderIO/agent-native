import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockForbiddenError extends Error {}

  return {
    MockForbiddenError,
    resolveAccess: vi.fn(),
    createScopedAgentAccessGrant: vi.fn(),
    getRequestContext: vi.fn(),
    getRequestUserEmail: vi.fn(),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server", () => ({
  buildAgentAccessUrl: vi.fn(({ path }: { path: string }) => path),
  createScopedAgentAccessGrant: (...args: unknown[]) =>
    mocks.createScopedAgentAccessGrant(...args),
  getRequestContext: (...args: unknown[]) => mocks.getRequestContext(...args),
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: mocks.MockForbiddenError,
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../server/lib/public-agent-context.js", () => ({
  CLIPS_AGENT_ACCESS_TTL_SECONDS: 7_200,
  getServerAppBasePath: () => "/clips",
}));

vi.mock("../server/lib/share-password.js", () => ({
  getRecordingAccessTokenResourceId: (id: string, password: string | null) =>
    password ? `${id}:password-scoped` : `${id}:update-scoped`,
}));

vi.mock("../shared/agent-context.js", () => ({
  buildAgentApiUrls: () => ({ contextUrl: "/clips/api/context" }),
  CLIP_AGENT_ACCESS_TOKEN_PREFIX: "clips",
}));

vi.mock("../shared/bug-report.js", () => ({
  BUG_REPORT_AGENT_ACCESS_TTL_SECONDS: 604_800,
}));

import action from "./create-recording-agent-link";

const recording = (password: string | null) => ({
  id: "recording-1",
  archivedAt: null,
  trashedAt: null,
  password,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestContext.mockReturnValue({
    requestOrigin: "https://clips.example",
  });
  mocks.getRequestUserEmail.mockReturnValue("viewer@example.com");
  mocks.createScopedAgentAccessGrant.mockReturnValue({
    token: "example-agent-token",
    expiresAt: "2026-09-28T12:00:00.000Z",
    ttlSeconds: 7_200,
  });
});

describe("create-recording-agent-link", () => {
  it.each(["viewer", "commenter"] as const)(
    "does not let a %s mint a link for a password-protected recording",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue({
        role,
        resource: recording("encrypted-example-password"),
      });

      await expect(action.run({ recordingId: "recording-1" })).rejects.toThrow(
        "Only recording owners, admins, and editors can create agent links for password-protected recordings",
      );
      expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "admin", "editor"] as const)(
    "allows a password-protected recording link for %s callers",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue({
        role,
        resource: recording("encrypted-example-password"),
      });

      await expect(
        action.run({ recordingId: "recording-1" }),
      ).resolves.toMatchObject({ contextUrl: "/clips/api/context" });
      expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "recording-1:password-scoped" }),
      );
    },
  );

  it("keeps unprotected viewer reshares available", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: recording(null),
    });

    await expect(
      action.run({ recordingId: "recording-1" }),
    ).resolves.toMatchObject({ contextUrl: "/clips/api/context" });
    expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "recording-1:update-scoped" }),
    );
  });
});
