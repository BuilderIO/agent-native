import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  canManage: false,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `/app${path}`,
}));

vi.mock("./use-clips-organization", () => ({
  useCanManageClipsWorkspace: () => state.canManage,
}));

import { useAiSetupHref, useStorageSetupHref } from "./settings-links";

beforeEach(() => {
  state.canManage = false;
});

describe("Clips settings links", () => {
  it("open Model for AI setup", () => {
    expect(useAiSetupHref()).toBe("/app/settings/model");
  });

  it("send owners and admins to Infrastructure storage", () => {
    state.canManage = true;
    expect(useStorageSetupHref()).toBe("/app/settings/infra#uploads");
  });

  it("give members no storage link", () => {
    expect(useStorageSetupHref()).toBeNull();
  });
});
