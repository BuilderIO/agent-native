import { beforeEach, describe, expect, it, vi } from "vitest";

const actionApi = vi.hoisted(() => ({
  callAppAction: vi.fn(),
  callAppActionGet: vi.fn(),
}));

vi.mock("./agent-chat/api", () => actionApi);

import {
  createWorkspaceAppEmbedSession,
  isWorkspaceSsoEnabled,
} from "./workspace-app-auth";

describe("mobile workspace app authentication", () => {
  beforeEach(() => {
    actionApi.callAppAction.mockReset();
    actionApi.callAppActionGet.mockReset();
  });

  it("reads the parent-scoped rollout flag through Dispatch", async () => {
    actionApi.callAppActionGet.mockResolvedValue({
      "dispatch.workspace-sso": true,
    });

    await expect(
      isWorkspaceSsoEnabled("https://dispatch.example"),
    ).resolves.toBe(true);
    expect(actionApi.callAppActionGet).toHaveBeenCalledWith(
      "get-feature-flags",
      {},
      "https://dispatch.example",
    );
  });

  it("mints an app-scoped start URL without passing the parent token to the app", async () => {
    actionApi.callAppAction.mockResolvedValue({
      app: "calendar",
      startUrl: "https://calendar.example/_agent-native/embed/start?ticket=t1",
      targetPath: "/calendar",
    });

    await expect(
      createWorkspaceAppEmbedSession({
        app: "calendar",
        path: "/calendar",
        baseUrl: "https://dispatch.example",
      }),
    ).resolves.toMatchObject({
      app: "calendar",
      startUrl: expect.stringContaining("https://calendar.example/"),
    });
    expect(actionApi.callAppAction).toHaveBeenCalledWith(
      "create-workspace-app-embed-session",
      { app: "calendar", path: "/calendar", chrome: "minimal" },
      "https://dispatch.example",
    );
  });

  it("rejects a malformed start URL from Dispatch", async () => {
    actionApi.callAppAction.mockResolvedValue({
      app: "calendar",
      startUrl: "javascript:alert(1)",
    });

    await expect(
      createWorkspaceAppEmbedSession({ app: "calendar" }),
    ).rejects.toThrow("invalid workspace app session");
  });
});
