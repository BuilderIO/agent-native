import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
}));
const apps = vi.hoisted(() => ({
  listWorkspaceApps: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: server.getRequestContext,
}));
vi.mock("../server/lib/app-creation-store.js", () => ({
  listWorkspaceApps: apps.listWorkspaceApps,
}));
vi.mock("../server/lib/mcp-gateway.js", () => ({
  createWorkspaceSsoEmbedSession: vi.fn(),
}));

import { assertWorkspaceEmbedSessionCaller } from "./create_workspace_app_embed_session.js";

describe("assertWorkspaceEmbedSessionCaller", () => {
  beforeEach(() => {
    apps.listWorkspaceApps.mockClear();
    server.getRequestContext.mockReturnValue({
      requestOrigin: "https://dispatch.agent-native.com",
    });
    apps.listWorkspaceApps.mockResolvedValue([
      {
        id: "custom-app",
        path: "/apps/custom-app",
        url: "https://dispatch.agent-native.com/apps/custom-app",
        isDispatch: false,
      },
    ]);
  });

  it("allows direct in-process calls and native parent bearer calls", async () => {
    await expect(
      assertWorkspaceEmbedSessionCaller(undefined),
    ).resolves.toBeUndefined();
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Authorization: "Bearer parent-session",
        }),
      ),
    ).resolves.toBeUndefined();
    expect(apps.listWorkspaceApps).not.toHaveBeenCalled();
  });

  it("allows a same-origin Dispatch browser caller", async () => {
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "https://dispatch.agent-native.com/apps/clips",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).resolves.toBeUndefined();
    expect(apps.listWorkspaceApps).toHaveBeenCalledWith({
      includeAgentCards: false,
      audience: "all",
    });
  });

  it("rejects cross-site and child-app browser callers", async () => {
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "https://evil.example/",
          "Sec-Fetch-Site": "cross-site",
        }),
      ),
    ).rejects.toThrow("requested by Dispatch");

    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "https://dispatch.agent-native.com/apps/custom-app/",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).rejects.toThrow("cannot mint sessions for themselves");
  });

  it("does not let a browser bearer bypass the fetch-metadata gate", async () => {
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Authorization: "Bearer attacker-set-header",
          Referer: "https://dispatch.agent-native.com/apps/custom-app/",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).rejects.toThrow("cannot mint sessions for themselves");
  });

  it("fails closed when the browser caller has no trustworthy parent context", async () => {
    server.getRequestContext.mockReturnValue(undefined);
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "https://dispatch.agent-native.com/",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).rejects.toThrow("requested by Dispatch");
  });
});
