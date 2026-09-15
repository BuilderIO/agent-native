import type { ActionEntry } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserLabs: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getCreativeContext: vi.fn(),
}));

vi.mock("@agent-native/core/labs/server", () => mocks);
vi.mock("@agent-native/core/server/request-context", () => mocks);
vi.mock("./context.js", () => mocks);

import {
  assertCreativeContextLabEnabled,
  gateCreativeContextActions,
  isCreativeContextLabAvailable,
} from "./labs.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCreativeContext.mockReturnValue({
    labKey: "content.creative-context",
  });
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

  it("requires the configured app Lab before Creative Context operations", async () => {
    mocks.getUserLabs.mockResolvedValue({ "content.creative-context": true });
    await expect(
      assertCreativeContextLabEnabled("user@example.com"),
    ).resolves.toBeUndefined();
    expect(mocks.getUserLabs).toHaveBeenCalledWith("user@example.com");
    expect(mocks.getCreativeContext).toHaveBeenCalled();

    mocks.getUserLabs.mockResolvedValue({ "content.creative-context": false });
    await expect(
      assertCreativeContextLabEnabled("user@example.com"),
    ).rejects.toThrow("Creative Context is disabled in Labs");
  });

  it("gates package actions with the configured app Lab", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const actions = gateCreativeContextActions({
      "manage-creative-context": {
        tool: {} as ActionEntry["tool"],
        run,
      },
    });
    const action = actions["manage-creative-context"];

    mocks.getUserLabs.mockResolvedValue({ "content.creative-context": true });
    await expect(
      action.run({}, { caller: "tool", userEmail: "user@example.test" }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.getUserLabs).toHaveBeenCalledWith("user@example.test");
    expect(mocks.getCreativeContext).toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();

    mocks.getUserLabs.mockResolvedValue({ "content.creative-context": false });
    await expect(
      action.run({}, { caller: "tool", userEmail: "user@example.test" }),
    ).rejects.toThrow("Creative Context is disabled in Labs");
    expect(run).toHaveBeenCalledOnce();
  });

  it("keeps approved purge cleanup runnable after disabling the Lab", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const actions = gateCreativeContextActions({
      "process-context-purge": {
        tool: {} as ActionEntry["tool"],
        run,
      },
    });
    mocks.getUserLabs.mockRejectedValue(new Error("settings unavailable"));

    await expect(actions["process-context-purge"].run({})).resolves.toEqual({
      ok: true,
    });
    expect(mocks.getUserLabs).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});
