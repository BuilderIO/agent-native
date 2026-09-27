import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "member@example.com" as string | null,
  stored: null as Record<string, unknown> | null,
  put: vi.fn(async (_email: string, _key: string, _value: unknown) => {}),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: vi.fn(() => state.email),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(async () => state.stored),
  putUserSetting: state.put,
}));

const { default: action } =
  await import("./update-analytics-notification-preferences");
const run = (args: Record<string, unknown>) => (action as any).run(args);

describe("update-analytics-notification-preferences action", () => {
  beforeEach(() => {
    state.email = "member@example.com";
    state.stored = null;
    state.put.mockClear();
  });

  it("merges the changed field into the saved preferences", async () => {
    state.stored = { bellSoundEnabled: true, other: "kept" };

    const result = await run({ errorEmailNotifications: true });

    expect(state.put).toHaveBeenCalledWith(
      "member@example.com",
      "analytics-user-prefs",
      { bellSoundEnabled: true, other: "kept", errorEmailNotifications: true },
    );
    expect(result).toEqual({
      errorEmailNotifications: true,
      bellSoundEnabled: true,
    });
  });

  it("starts from nothing saved as both off", async () => {
    const result = await run({ bellSoundEnabled: true });

    expect(result).toEqual({
      errorEmailNotifications: false,
      bellSoundEnabled: true,
    });
  });

  it("rejects a call that changes nothing", () => {
    expect((action as any).schema.safeParse({}).success).toBe(false);
  });

  it("requires a signed-in user", async () => {
    state.email = null;
    await expect(run({ bellSoundEnabled: true })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(state.put).not.toHaveBeenCalled();
  });
});
