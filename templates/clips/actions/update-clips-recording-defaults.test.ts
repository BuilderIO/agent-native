import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "member@example.com" as string | null,
  stored: null as Record<string, unknown> | null,
  organizationDefault: null as string | null,
  enforced: false,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.email,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async () => state.stored,
  mutateUserSetting: async (
    _email: string,
    _key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    state.stored = updater(state.stored);
    return state.stored;
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  readActiveOrganizationVisibilityPolicy: async () => ({
    defaultVisibility: state.organizationDefault,
    enforced: state.enforced,
  }),
}));

import getAction from "./get-clips-recording-defaults";
import updateAction from "./update-clips-recording-defaults";

type RunnableAction = {
  schema: { safeParse: (value: unknown) => { success: boolean } };
  run: (args: unknown) => Promise<unknown>;
};

const update = updateAction as unknown as RunnableAction;
const get = getAction as unknown as RunnableAction;

beforeEach(() => {
  state.email = "member@example.com";
  state.stored = null;
  state.organizationDefault = null;
  state.enforced = false;
});

describe("Clips recording defaults actions", () => {
  it("reads the built-in defaults before anyone saved anything", async () => {
    await expect(get.run({})).resolves.toEqual({
      defaultPlaybackSpeed: "1.2",
      defaultRecordingVisibility: null,
      organizationDefaultVisibility: null,
      organizationVisibilityEnforced: false,
      effectiveRecordingVisibility: "public",
      recordingVisibilitySource: "built-in",
    });
  });

  it("reports the organization default when the user never chose one", async () => {
    state.organizationDefault = "private";
    state.stored = { viewNotifications: false };

    await expect(get.run({})).resolves.toEqual({
      defaultPlaybackSpeed: "1.2",
      defaultRecordingVisibility: null,
      organizationDefaultVisibility: "private",
      organizationVisibilityEnforced: false,
      effectiveRecordingVisibility: "private",
      recordingVisibilitySource: "organization",
    });
  });

  it("lets a personal choice override the organization default", async () => {
    state.organizationDefault = "private";
    state.stored = { defaultRecordingVisibility: "public" };

    await expect(get.run({})).resolves.toMatchObject({
      defaultRecordingVisibility: "public",
      organizationDefaultVisibility: "private",
      organizationVisibilityEnforced: false,
      effectiveRecordingVisibility: "public",
      recordingVisibilitySource: "personal",
    });
  });

  it("ignores a stored personal choice while the organization enforces its default", async () => {
    state.organizationDefault = "org";
    state.enforced = true;
    state.stored = { defaultRecordingVisibility: "public" };

    await expect(get.run({})).resolves.toMatchObject({
      defaultRecordingVisibility: null,
      organizationVisibilityEnforced: true,
      effectiveRecordingVisibility: "org",
      recordingVisibilitySource: "organization",
    });
  });

  it("refuses a personal visibility while the organization enforces its default", async () => {
    state.organizationDefault = "org";
    state.enforced = true;

    await expect(
      update.run({ defaultRecordingVisibility: "public" }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/enforces/),
      statusCode: 403,
    });
    expect(state.stored).toBeNull();
  });

  it("saves one default and keeps the other Clips preferences", async () => {
    state.stored = {
      includeFullVideoInAi: true,
      viewNotifications: false,
      defaultRecordingVisibility: "org",
    };

    await expect(update.run({ defaultPlaybackSpeed: "1.5" })).resolves.toEqual({
      defaultPlaybackSpeed: "1.5",
      defaultRecordingVisibility: "org",
      organizationDefaultVisibility: null,
      organizationVisibilityEnforced: false,
      effectiveRecordingVisibility: "org",
      recordingVisibilitySource: "personal",
    });
    expect(state.stored).toEqual({
      includeFullVideoInAi: true,
      viewNotifications: false,
      defaultRecordingVisibility: "org",
      defaultPlaybackSpeed: "1.5",
    });
  });

  it("clears the personal visibility so the organization default applies", async () => {
    state.organizationDefault = "private";
    state.stored = {
      viewNotifications: false,
      defaultRecordingVisibility: "public",
      defaultPlaybackSpeed: "2",
    };

    await expect(
      update.run({ defaultRecordingVisibility: null }),
    ).resolves.toEqual({
      defaultPlaybackSpeed: "2",
      defaultRecordingVisibility: null,
      organizationDefaultVisibility: "private",
      organizationVisibilityEnforced: false,
      effectiveRecordingVisibility: "private",
      recordingVisibilitySource: "organization",
    });
    expect(state.stored).toEqual({
      viewNotifications: false,
      defaultPlaybackSpeed: "2",
    });
  });

  it("rejects an empty patch and values Settings doesn't offer", () => {
    expect(update.schema.safeParse({}).success).toBe(false);
    expect(update.schema.safeParse({ defaultPlaybackSpeed: "9" }).success).toBe(
      false,
    );
    expect(
      update.schema.safeParse({ defaultRecordingVisibility: "everyone" })
        .success,
    ).toBe(false);
    expect(
      update.schema.safeParse({ defaultRecordingVisibility: "private" })
        .success,
    ).toBe(true);
    expect(
      update.schema.safeParse({ defaultRecordingVisibility: null }).success,
    ).toBe(true);
  });

  it("requires a signed-in user", async () => {
    state.email = null;
    await expect(get.run({})).rejects.toThrow("Sign in required");
    await expect(
      update.run({ defaultRecordingVisibility: "private" }),
    ).rejects.toThrow("Sign in required");
  });
});
