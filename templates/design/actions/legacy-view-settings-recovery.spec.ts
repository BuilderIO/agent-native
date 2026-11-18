import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "designer@example.com",
}));
vi.mock("@agent-native/core/settings", () => mocks);

import getAction from "./get-view-settings.js";
import action from "./update-view-settings.js";

beforeEach(() => vi.clearAllMocks());

it.each([
  { tweaksPanelOpen: "yes" },
  { tweaksPanelCollapsed: 1 },
  { tweaksPanelPosition: null },
  { tweaksPanelPosition: { x: "16", y: 64 } },
  { tweaksPanelPosition: { x: 16 } },
])(
  "recovers invalid stored panel fields on read and update: %j",
  async (invalid) => {
    let stored: unknown = { pixelGrid: false, ...invalid };
    mocks.getUserSetting.mockImplementation(async () => stored);
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        stored = updater(stored);
      },
    );

    const read = await getAction.run({});
    const updated = await action.run({ rulers: true });

    expect(read).toMatchObject({
      pixelGrid: false,
      tweaksPanelPosition: { x: 16, y: 64 },
    });
    expect(updated).toMatchObject({
      pixelGrid: false,
      rulers: true,
      tweaksPanelOpen: true,
      tweaksPanelCollapsed: false,
      tweaksPanelPosition: { x: 16, y: 64 },
    });
    expect(await getAction.run({})).toEqual(updated);
  },
);
