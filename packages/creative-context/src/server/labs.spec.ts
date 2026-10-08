import type { ActionEntry } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserLabEnabled: vi.fn(),
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
    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
  });

  it("uses the shared Creative Context Lab by default", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);

    await expect(
      isCreativeContextLabAvailable("user@example.com"),
    ).resolves.toBe(true);
    expect(mocks.getUserLabEnabled).toHaveBeenCalledWith(
      "user@example.com",
      "creative-context.library",
    );
  });

  it("supports an app's existing Creative Context Lab key", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);

    await expect(
      isCreativeContextLabAvailable(
        "user@example.com",
        "content.creative-context",
      ),
    ).resolves.toBe(true);
  });

  it("preserves unreadable lab state as an error", async () => {
    mocks.getUserLabEnabled.mockRejectedValue(
      new Error("settings unavailable"),
    );

    await expect(
      isCreativeContextLabAvailable("user@example.com"),
    ).rejects.toThrow("settings unavailable");
  });

  it("requires the configured app Lab before Creative Context operations", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);
    await expect(
      assertCreativeContextLabEnabled("user@example.com"),
    ).resolves.toBeUndefined();
    expect(mocks.getUserLabEnabled).toHaveBeenCalledWith(
      "user@example.com",
      "content.creative-context",
    );
    expect(mocks.getCreativeContext).toHaveBeenCalled();

    mocks.getUserLabEnabled.mockResolvedValue(false);
    await expect(
      assertCreativeContextLabEnabled("user@example.com"),
    ).rejects.toMatchObject({
      message: "Creative Context is disabled in Labs",
      errorCode: "creative_context_disabled",
      statusCode: 404,
    });
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

    mocks.getUserLabEnabled.mockResolvedValue(true);
    await expect(
      action.run({}, { caller: "tool", userEmail: "user@example.test" }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.getUserLabEnabled).toHaveBeenCalledWith(
      "user@example.test",
      "content.creative-context",
    );
    expect(mocks.getCreativeContext).toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();

    mocks.getUserLabEnabled.mockResolvedValue(false);
    await expect(
      action.run({}, { caller: "tool", userEmail: "user@example.test" }),
    ).rejects.toThrow("Creative Context is disabled in Labs");
    expect(run).toHaveBeenCalledOnce();
  });

  it("filters action discovery using each requesting user's configured Lab", async () => {
    const actions = gateCreativeContextActions({
      "manage-creative-context": {
        tool: {} as ActionEntry["tool"],
        run: vi.fn(),
      },
    });
    const action = actions["manage-creative-context"];
    mocks.getUserLabEnabled.mockImplementation(
      async (email: string) => email === "enabled@example.test",
    );

    await expect(
      action.agentDiscoveryAvailable?.({
        caller: "tool",
        userEmail: "disabled@example.test",
      }),
    ).resolves.toBe(false);
    await expect(
      action.agentDiscoveryAvailable?.({
        caller: "tool",
        userEmail: "enabled@example.test",
      }),
    ).resolves.toBe(true);
    expect(mocks.getUserLabEnabled.mock.calls).toEqual([
      ["disabled@example.test", "content.creative-context"],
      ["enabled@example.test", "content.creative-context"],
    ]);
  });

  it("keeps approved purge cleanup runnable after disabling the Lab", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const actions = gateCreativeContextActions({
      "process-context-purge": {
        tool: {} as ActionEntry["tool"],
        run,
      },
    });
    mocks.getUserLabEnabled.mockRejectedValue(
      new Error("settings unavailable"),
    );

    await expect(actions["process-context-purge"].run({})).resolves.toEqual({
      ok: true,
    });
    expect(mocks.getUserLabEnabled).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});
