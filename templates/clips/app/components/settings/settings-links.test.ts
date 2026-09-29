import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  redesign: false,
  canManage: false,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `/app${path}`,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlagState: () => ({ status: "ready", enabled: state.redesign }),
}));

vi.mock("./use-clips-organization", () => ({
  useCanManageClipsWorkspace: () => state.canManage,
}));

import { useAiSetupHref, useStorageSetupHref } from "./settings-links";

beforeEach(() => {
  state.redesign = false;
  state.canManage = false;
});

describe("Clips settings links", () => {
  it("keep today's General anchors while the redesign is off", () => {
    expect(useAiSetupHref()).toBe("/app/settings/general#ai-providers");
    expect(useStorageSetupHref()).toBe("/app/settings/general#video-storage");
  });

  it("open Model for AI setup with the redesign on", () => {
    state.redesign = true;
    expect(useAiSetupHref()).toBe("/app/settings/model");
  });

  it("send owners and admins to Infrastructure storage", () => {
    state.redesign = true;
    state.canManage = true;
    expect(useStorageSetupHref()).toBe("/app/settings/infra#uploads");
  });

  it("give members no storage link", () => {
    state.redesign = true;
    expect(useStorageSetupHref()).toBeNull();
  });
});
