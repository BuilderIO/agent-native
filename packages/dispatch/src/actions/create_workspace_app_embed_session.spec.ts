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

  it("allows the native marker when Chromium adds cross-site fetch metadata", async () => {
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          "Sec-Fetch-Site": "cross-site",
          "X-Agent-Native-CSRF": "1",
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

  it("allows a workspace gateway caller when requestOrigin matches forwarded host", async () => {
    server.getRequestContext.mockReturnValue({
      requestOrigin: "http://127.0.0.1:8080",
    });
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "http://127.0.0.1:8080/dispatch/apps/calendar",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects when the browser gateway origin does not match requestOrigin", async () => {
    server.getRequestContext.mockReturnValue({
      requestOrigin: "http://127.0.0.1:8092",
    });
    await expect(
      assertWorkspaceEmbedSessionCaller(
        new Headers({
          Referer: "http://127.0.0.1:8080/dispatch/apps/calendar",
          "Sec-Fetch-Site": "same-origin",
        }),
      ),
    ).rejects.toThrow("requested by Dispatch");
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
