import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveIntegrationSourceContext: vi.fn(),
  getRequestUserEmail: vi.fn((): string | undefined => "member@example.com"),
  getRequestOrgId: vi.fn((): string | undefined => "org-a"),
}));

vi.mock("@agent-native/core/integrations", () => ({
  resolveIntegrationSourceContext: mocks.resolveIntegrationSourceContext,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
}));

const action = (await import("./resolve-integration-source-context.js"))
  .default;

describe("resolve-integration-source-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("member@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-a");
  });

  it("is an authenticated, read-only, non-consequential public action", () => {
    expect(action.readOnly).toBe(true);
    expect(action.parallelSafe).toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
      isConsequential: false,
    });
  });

  it("resolves provenance only within the caller's exact owner and org scope", async () => {
    mocks.resolveIntegrationSourceContext.mockResolvedValue({
      platform: "slack",
      sourceUrl: "https://example.slack.com/archives/C1/p1",
    });

    await expect(action.run({ integrationTaskId: "task-1" })).resolves.toEqual({
      platform: "slack",
      sourceUrl: "https://example.slack.com/archives/C1/p1",
    });
    expect(mocks.resolveIntegrationSourceContext).toHaveBeenCalledWith(
      "task-1",
      "member@example.com",
      "org-a",
    );
  });

  it("passes a null org exactly when the request has no organization", async () => {
    mocks.getRequestOrgId.mockReturnValue(undefined);
    mocks.resolveIntegrationSourceContext.mockResolvedValue(null);

    await expect(
      action.run({ integrationTaskId: "task-personal" }),
    ).resolves.toBeNull();
    expect(mocks.resolveIntegrationSourceContext).toHaveBeenCalledWith(
      "task-personal",
      "member@example.com",
      null,
    );
  });

  it("fails closed without an authenticated request identity", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run({ integrationTaskId: "task-1" })).rejects.toThrow(
      "authenticated user",
    );
    expect(mocks.resolveIntegrationSourceContext).not.toHaveBeenCalled();
  });
});
