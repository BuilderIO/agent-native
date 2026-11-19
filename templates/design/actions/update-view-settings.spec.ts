import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn<() => string | undefined>(),
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));

import getAction from "./get-view-settings.js";
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

describe("view settings compatibility", () => {
  it.each([
    {
      stored: null,
      legacy: {
        tweaksPanelOpen: true,
        tweaksPanelCollapsed: false,
        tweaksPanelPosition: { x: 16, y: 64 },
      },
    },
    {
      stored: { tweaksPanelOpen: false, tweaksPanelPosition: { x: 32, y: 96 } },
      legacy: {
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: false,
        tweaksPanelPosition: { x: 32, y: 96 },
      },
    },
    {
      stored: {
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: { x: 72, y: 90 },
      },
      legacy: {
        tweaksPanelOpen: false,
        tweaksPanelCollapsed: true,
        tweaksPanelPosition: { x: 72, y: 90 },
      },
    },
  ])(
    "returns compatible fields on read and update for $stored",
    async ({ stored, legacy }) => {
      mocks.getUserSetting.mockResolvedValue(stored);
      let written: unknown;
      mocks.mutateUserSetting.mockImplementation(
        async (_email, _key, updater) => {
          written = updater(stored);
        },
      );

      const read = await getAction.run({});
      const updated = await action.run({ rulers: true });

      expect.soft(read).toMatchObject(legacy);
      expect.soft(updated).toMatchObject({ ...legacy, rulers: true });
      expect(written).toEqual(updated);
      expect(mocks.getUserSetting).toHaveBeenCalledWith(
        "designer@example.com",
        "design-view-settings",
      );
    },
  );

  it("saves legacy panel updates and returns them on the next read", async () => {
    let stored: unknown = { pixelGrid: false, tweaksPanelOpen: true };
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        stored = updater(stored);
      },
    );
    mocks.getUserSetting.mockImplementation(async () => stored);

    const patch = {
      tweaksPanelOpen: false,
      tweaksPanelCollapsed: true,
      tweaksPanelPosition: { x: 32, y: 96 },
      rulers: true,
    };
    const parsed = action.schema.parse(patch);
    expect(parsed).toEqual(patch);

    const updated = await action.run(parsed);
    const read = await getAction.run({});

    expect(updated).toMatchObject({ ...patch, pixelGrid: false });
    expect(stored).toEqual(updated);
    expect(read).toEqual(updated);
  });

  it.each([
    { tweaksPanelOpen: "yes" },
    { tweaksPanelCollapsed: 1 },
    { tweaksPanelPosition: null },
    { tweaksPanelPosition: { x: "16", y: 64 } },
    { tweaksPanelPosition: { x: 16 } },
  ])("rejects invalid legacy panel updates: %j", (patch) => {
    expect(() => action.schema.parse(patch)).toThrow();
  });
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
