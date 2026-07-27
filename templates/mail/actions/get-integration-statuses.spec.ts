import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateGetMany: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGetMany: mocks.appStateGetMany,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import action from "./get-integration-statuses";

describe("get-integration-statuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.appStateGetMany.mockResolvedValue({
      apollo: { apiKey: "example-apollo-key" },
      hubspot: null,
      gong: { apiKey: "example-gong-key" },
      pylon: null,
    });
  });

  it("returns booleans from one batched state read without exposing keys", async () => {
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

  it("requires an authenticated request context", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);

    await expect(action.run({})).rejects.toThrow("no authenticated user");
    expect(mocks.appStateGetMany).not.toHaveBeenCalled();
  });
});
