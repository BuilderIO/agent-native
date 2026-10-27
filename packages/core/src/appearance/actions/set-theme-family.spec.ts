import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  appConfig: {
    themeFamily: {
      families: ["original", "agent-native"],
      defaultFamily: "agent-native",
    },
  } as { themeFamily?: { families?: string[]; defaultFamily?: string } },
  putUserSetting: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("../../client/app-config.js", () => ({
  injectedAgentNativeConfig: () => deps.appConfig,
}));
vi.mock("../../settings/user-settings.js", () => ({
  putUserSetting: deps.putUserSetting,
}));
vi.mock("../../application-state/script-helpers.js", () => ({
  writeAppState: deps.writeAppState,
}));

import { themeFamilyAppStateKey } from "../theme-family.js";
import action from "./set-theme-family.js";

describe("set-theme-family action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.appConfig = {
      themeFamily: {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      },
    };
    deps.putUserSetting.mockResolvedValue(undefined);
    deps.writeAppState.mockResolvedValue(undefined);
  });

  it("declares the preference update as a non-destructive closed-world write", () => {
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("persists the app-specific user setting and syncs the open app state", async () => {
    const result = await action.run(
      { family: "original" },
      { caller: "tool", userEmail: "steve@example.test", appId: "sample-app" },
    );

    expect(deps.putUserSetting).toHaveBeenCalledWith(
      "steve@example.test",
      "theme-family:sample-app",
      { family: "original" },
    );
    expect(deps.writeAppState).toHaveBeenCalledWith(
      themeFamilyAppStateKey("sample-app"),
      { family: "original" },
    );
    expect(result).toEqual({ family: "original", appId: "sample-app" });
  });

  it("uses the documented stable fallback only when appId is absent", async () => {
    await action.run(
      { family: "agent-native" },
      { caller: "tool", userEmail: "steve@example.test" },
    );

    expect(deps.putUserSetting).toHaveBeenCalledWith(
      "steve@example.test",
      "theme-family:__no_app_id__",
      { family: "agent-native" },
    );
    expect(deps.writeAppState).toHaveBeenCalledWith(themeFamilyAppStateKey(), {
      family: "agent-native",
    });
  });

  it("does not report success when syncing application state fails", async () => {
    deps.writeAppState.mockRejectedValue(new Error("database unavailable"));

    await expect(
      action.run(
        { family: "original" },
        {
          caller: "tool",
          userEmail: "steve@example.test",
          appId: "sample-app",
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "theme_family_sync_failed",
      statusCode: 503,
    });
    expect(deps.putUserSetting).toHaveBeenCalledOnce();
  });

  it("rejects unsupported family values", () => {
    expect(action.schema.safeParse({ family: "dark" }).success).toBe(false);
  });

  it("rejects a registered family that is disabled by the app config", async () => {
    deps.appConfig = {
      themeFamily: { families: ["original"], defaultFamily: "original" },
    };

    await expect(
      action.run(
        { family: "agent-native" },
        {
          caller: "tool",
          userEmail: "steve@example.test",
          appId: "sample-app",
        },
      ),
    ).rejects.toMatchObject({
      errorCode: "theme_family_not_enabled",
      statusCode: 400,
    });
    expect(deps.putUserSetting).not.toHaveBeenCalled();
    expect(deps.writeAppState).not.toHaveBeenCalled();
  });
});
