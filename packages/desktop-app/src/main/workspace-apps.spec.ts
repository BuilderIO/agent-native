import { WORKSPACE_APP_LIST_FLAG_KEY } from "@agent-native/shared-app-config";
import { describe, expect, it, vi } from "vitest";

import { loadDesktopWorkspaceApps } from "./workspace-apps.js";

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function sessionFor(
  fetch: ReturnType<typeof vi.fn>,
  cookies?: ReturnType<typeof vi.fn>,
): Parameters<typeof loadDesktopWorkspaceApps>[0]["identitySession"] {
  return { fetch, ...(cookies ? { cookies: { get: cookies } } : {}) } as never;
}

describe("loadDesktopWorkspaceApps", () => {
  it("fails closed without requesting the workspace inventory when disabled", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ [WORKSPACE_APP_LIST_FLAG_KEY]: false }));

    await expect(
      loadDesktopWorkspaceApps({
        identitySession: sessionFor(fetch),
        dispatchOrigin: "https://dispatch.example.com",
      }),
    ).resolves.toEqual({ enabled: false, apps: [] });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns only ready, launchable app metadata when enabled", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ [WORKSPACE_APP_LIST_FLAG_KEY]: true }))
      .mockResolvedValueOnce(
        response({
          apps: [
            { id: "dispatch", path: "/dispatch", status: "ready" },
            {
              id: "alpha",
              name: "Alpha",
              description: "Workspace tool",
              path: "/alpha",
              status: "ready",
            },
            { id: "pending", path: "/pending", status: "pending" },
            { id: "unsafe", url: "javascript:alert(1)", status: "ready" },
          ],
        }),
      );

    const result = await loadDesktopWorkspaceApps({
      identitySession: sessionFor(fetch),
      dispatchOrigin: "https://dispatch.example.com",
    });

    expect(result).toEqual({
      enabled: true,
      apps: [
        expect.objectContaining({
          id: "alpha",
          name: "Alpha",
          url: "https://dispatch.example.com/alpha",
          enabled: true,
          isBuiltIn: false,
          mode: "prod",
          workspaceSso: true,
        }),
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toContain(
      "includeAgentCards=false&audience=all",
    );
  });

  it("passes the authenticated session cookies to the rollout and inventory requests", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ [WORKSPACE_APP_LIST_FLAG_KEY]: true }))
      .mockResolvedValueOnce(response({ apps: [] }));
    const cookies = vi.fn().mockResolvedValue([
      {
        domain: "dispatch.example.com",
        hostOnly: true,
        name: "an_session_dispatch",
        value: "parent-session",
      },
      {
        domain: "other.example.com",
        hostOnly: true,
        name: "unrelated",
        value: "must-not-leak",
      },
    ]);

    await loadDesktopWorkspaceApps({
      identitySession: sessionFor(fetch, cookies),
      dispatchOrigin: "https://dispatch.example.com",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/_agent-native/actions/get-feature-flags"),
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          Cookie: "an_session_dispatch=parent-session",
        },
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/_agent-native/actions/list-workspace-apps"),
      expect.objectContaining({
        credentials: "include",
        headers: {
          accept: "application/json",
          Cookie: "an_session_dispatch=parent-session",
        },
      }),
    );
  });

  it("does not expose a failed or malformed response as a normal inventory", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ [WORKSPACE_APP_LIST_FLAG_KEY]: true }))
      .mockResolvedValueOnce(response({ nope: true }));

    await expect(
      loadDesktopWorkspaceApps({
        identitySession: sessionFor(fetch),
        dispatchOrigin: "https://dispatch.example.com",
      }),
    ).resolves.toEqual({ enabled: true, apps: [] });

    fetch.mockReset();
    fetch.mockResolvedValue(response({}, 401));
    await expect(
      loadDesktopWorkspaceApps({
        identitySession: sessionFor(fetch),
        dispatchOrigin: "https://dispatch.example.com",
      }),
    ).resolves.toEqual({ enabled: false, apps: [] });
  });
});
