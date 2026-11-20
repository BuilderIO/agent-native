import { expect, it, vi } from "vitest";

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

it("preserves malformed legacy values until explicitly replaced", async () => {
  let stored: Record<string, unknown> = {
    pixelGrid: false,
    tweaksPanelOpen: "invalid",
    tweaksPanelCollapsed: true,
    tweaksPanelPosition: { x: "invalid", y: 64 },
  };
  mocks.getUserSetting.mockImplementation(async () => stored);
  mocks.mutateUserSetting.mockImplementation(async (_email, _key, updater) => {
    stored = updater(stored);
  });

  const updated = await action.run({ rulers: true });
  expect(updated).toMatchObject({
    rulers: true,
    pixelGrid: false,
    tweaksPanelOpen: true,
    tweaksPanelCollapsed: true,
    tweaksPanelPosition: { x: 16, y: 64 },
  });
  expect(stored).toMatchObject({
    rulers: true,
    pixelGrid: false,
    tweaksPanelOpen: "invalid",
    tweaksPanelCollapsed: true,
    tweaksPanelPosition: { x: "invalid", y: 64 },
  });
  expect(await getAction.run({})).toEqual(updated);

  const replacement = {
    tweaksPanelOpen: false,
    tweaksPanelPosition: { x: 32, y: 96 },
  };
  expect(await action.run(replacement)).toMatchObject(replacement);
  expect(stored).toMatchObject(replacement);
});
