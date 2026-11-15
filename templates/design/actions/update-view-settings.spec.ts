import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn<() => string | undefined>(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/settings", () => ({
  mutateUserSetting: mocks.mutateUserSetting,
}));

import action from "./update-view-settings.js";

async function rejectionFrom(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected run to reject");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
  mocks.mutateUserSetting.mockImplementation(
    async (
      _email: string,
      _key: string,
      updater: (current: Record<string, unknown> | null) => unknown,
    ) => updater(null),
  );
});

describe("update-view-settings", () => {
  it("saves the patch for the signed-in user", async () => {
    await action.run({} as never);

    expect(mocks.mutateUserSetting).toHaveBeenCalledTimes(1);
    expect(mocks.mutateUserSetting.mock.calls[0]?.[0]).toBe(
      "designer@example.com",
    );
  });

  it("refuses a request with no signed-in user as a typed 401 and saves nothing", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    const error = await rejectionFrom(() => action.run({} as never));

    expect(error).toMatchObject({
      errorCode: "unauthenticated",
      statusCode: 401,
      message: "Sign in to change your view settings.",
    });
    expect(mocks.mutateUserSetting).not.toHaveBeenCalled();
  });
});
