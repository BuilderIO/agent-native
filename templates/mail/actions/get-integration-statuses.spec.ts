import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateGetMany: vi.fn(),
  resolveCredential: vi.fn(),
  getCredentialContext: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGet: vi.fn(),
  appStateGetMany: mocks.appStateGetMany,
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
  saveCredential: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
  getSession: vi.fn(),
}));

import action from "./get-integration-statuses";

const ctx = { userEmail: "user@example.com", orgId: null };

describe("get-integration-statuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialContext.mockReturnValue(ctx);
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.appStateGetMany.mockResolvedValue({
      apollo: { apiKey: "example-apollo-key" },
      hubspot: null,
      gong: { apiKey: "example-gong-key" },
      pylon: null,
    });
  });

  it("returns booleans from one batched legacy read without exposing keys", async () => {
    const result = await action.run({});

    expect(mocks.appStateGetMany).toHaveBeenCalledWith("user@example.com", [
      "apollo",
      "hubspot",
      "gong",
      "pylon",
    ]);
    expect(result).toEqual({
      apollo: true,
      hubspot: false,
      gong: true,
      pylon: false,
    });
    expect(JSON.stringify(result)).not.toContain("example-apollo-key");
    expect(JSON.stringify(result)).not.toContain("example-gong-key");
  });

  it("reports a key held only in the credential store as connected", async () => {
    mocks.resolveCredential.mockImplementation(async (key: string) =>
      key === "PYLON_API_KEY" ? "example-stored-key" : undefined,
    );

    const result = await action.run({});

    expect(result).toMatchObject({ pylon: true, hubspot: false });
    expect(JSON.stringify(result)).not.toContain("example-stored-key");
  });

  it("requires an authenticated request context", async () => {
    mocks.getCredentialContext.mockReturnValue(null);

    await expect(action.run({})).rejects.toThrow("no authenticated user");
    expect(mocks.appStateGetMany).not.toHaveBeenCalled();
  });
});
