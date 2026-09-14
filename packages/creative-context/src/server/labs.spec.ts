import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserLabs: vi.fn() }));

vi.mock("@agent-native/core/labs/server", () => mocks);

import { isCreativeContextLabAvailable } from "./labs.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCreativeContextLabAvailable", () => {
  it("does not expose the library without an authenticated user", async () => {
    await expect(isCreativeContextLabAvailable(undefined)).resolves.toBe(false);
    expect(mocks.getUserLabs).not.toHaveBeenCalled();
  });

  it("uses the shared Creative Context Lab by default", async () => {
    mocks.getUserLabs.mockResolvedValue({ "creative-context.library": true });

    await expect(
      isCreativeContextLabAvailable("user@example.com"),
    ).resolves.toBe(true);
    expect(mocks.getUserLabs).toHaveBeenCalledWith("user@example.com");
  });

  it("supports an app's existing Creative Context Lab key", async () => {
    mocks.getUserLabs.mockResolvedValue({ "content.creative-context": true });

    await expect(
      isCreativeContextLabAvailable(
        "user@example.com",
        "content.creative-context",
      ),
    ).resolves.toBe(true);
  });

  it("preserves unreadable lab state as an error", async () => {
    mocks.getUserLabs.mockRejectedValue(new Error("settings unavailable"));

    await expect(
      isCreativeContextLabAvailable("user@example.com"),
    ).rejects.toThrow("settings unavailable");
  });
});
