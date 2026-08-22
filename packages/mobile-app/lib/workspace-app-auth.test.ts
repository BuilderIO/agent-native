import { beforeEach, describe, expect, it, vi } from "vitest";

const actionApi = vi.hoisted(() => ({
  callAppAction: vi.fn(),
  callAppActionGet: vi.fn(),
}));

vi.mock("./agent-chat/api", () => actionApi);

import {
  clearLiveWorkspaceAppSessions,
  createWorkspaceAppEmbedSession,
  forgetLiveWorkspaceAppSession,
  hasLiveWorkspaceAppSession,
  isWorkspaceSsoEnabled,
  peekWorkspaceSsoEnabled,
  readWorkspaceSsoEnabled,
  rememberLiveWorkspaceAppSession,
} from "./workspace-app-auth";

// Mirrors the source module's own TTL/reuse windows so the boundary tests
// below read as "one tick past the window" rather than a magic number.
const SSO_FLAG_TTL_MS = 10 * 60 * 1000;
const EMBED_SESSION_REUSE_MS = 55 * 60 * 1000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mobile workspace app authentication", () => {
  beforeEach(() => {
    actionApi.callAppAction.mockReset();
    actionApi.callAppActionGet.mockReset();
    clearLiveWorkspaceAppSessions();
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

  it("fans one parent-authenticated flow out to every default mobile app", async () => {
    const apps = ["mail", "calendar", "content", "analytics"];
    actionApi.callAppAction.mockImplementation(
      async (
        _name: string,
        args: { app: string; path?: string; chrome?: string },
      ) => ({
        app: args.app,
        startUrl: `https://${args.app}.example/_agent-native/embed/start?ticket=${args.app}-ticket`,
        targetPath: args.path,
      }),
    );

    const sessions = [];
    for (const app of apps) {
      sessions.push(
        await createWorkspaceAppEmbedSession({
          app,
          path: "/",
          baseUrl: "https://dispatch.example",
        }),
      );
    }

    expect(sessions.map((session) => session.app)).toEqual(apps);
    expect(new Set(sessions.map((session) => session.startUrl))).toHaveLength(
      apps.length,
    );
    expect(actionApi.callAppAction).toHaveBeenCalledTimes(apps.length);
    for (const [index, app] of apps.entries()) {
      expect(actionApi.callAppAction).toHaveBeenNthCalledWith(
        index + 1,
        "create-workspace-app-embed-session",
        { app, path: "/", chrome: "minimal" },
        "https://dispatch.example",
      );
    }
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

  it("rejects a reusable credential in an otherwise valid-looking start URL", async () => {
    actionApi.callAppAction.mockResolvedValue({
      app: "calendar",
      startUrl:
        "https://calendar.example/_agent-native/embed/start?ticket=t1&token=parent-token",
    });

    await expect(
      createWorkspaceAppEmbedSession({ app: "calendar" }),
    ).rejects.toThrow("invalid workspace app session");
  });
});

describe("peekWorkspaceSsoEnabled / readWorkspaceSsoEnabled caching", () => {
  beforeEach(() => {
    actionApi.callAppAction.mockReset();
    actionApi.callAppActionGet.mockReset();
    clearLiveWorkspaceAppSessions();
  });

  it("returns null when the rollout flag has never been read", () => {
    expect(peekWorkspaceSsoEnabled()).toBeNull();
  });

  it("caches a successful read so peek serves it and a second call skips the network", async () => {
    actionApi.callAppActionGet.mockResolvedValue({
      "dispatch.workspace-sso": true,
    });

    await expect(
      readWorkspaceSsoEnabled("https://dispatch.example"),
    ).resolves.toBe(true);
    expect(peekWorkspaceSsoEnabled()).toBe(true);

    await expect(
      readWorkspaceSsoEnabled("https://dispatch.example"),
    ).resolves.toBe(true);
    expect(actionApi.callAppActionGet).toHaveBeenCalledTimes(1);
  });

  it("expires the cached flag once the 10-minute TTL lapses", async () => {
    actionApi.callAppActionGet.mockResolvedValue({
      "dispatch.workspace-sso": true,
    });

    await readWorkspaceSsoEnabled("https://dispatch.example");
    const afterWrite = Date.now();

    expect(peekWorkspaceSsoEnabled(afterWrite + SSO_FLAG_TTL_MS)).toBeNull();
  });

  it("shares one in-flight request across concurrent callers", async () => {
    const gate = deferred<Record<string, unknown>>();
    actionApi.callAppActionGet.mockReturnValue(gate.promise);

    const first = readWorkspaceSsoEnabled("https://dispatch.example");
    const second = readWorkspaceSsoEnabled("https://dispatch.example");

    gate.resolve({ "dispatch.workspace-sso": true });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(actionApi.callAppActionGet).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected read, so the next call retries", async () => {
    actionApi.callAppActionGet
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ "dispatch.workspace-sso": true });

    await expect(
      readWorkspaceSsoEnabled("https://dispatch.example"),
    ).rejects.toThrow("network down");
    expect(peekWorkspaceSsoEnabled()).toBeNull();

    await expect(
      readWorkspaceSsoEnabled("https://dispatch.example"),
    ).resolves.toBe(true);
    expect(actionApi.callAppActionGet).toHaveBeenCalledTimes(2);
  });
});

describe("live workspace app session reuse cache", () => {
  beforeEach(() => {
    clearLiveWorkspaceAppSessions();
  });

  it("reuses a session inside the 55-minute window and stops at the boundary", () => {
    const establishedAt = 1_000_000;
    rememberLiveWorkspaceAppSession("calendar", "parent-token", establishedAt);

    expect(
      hasLiveWorkspaceAppSession(
        "calendar",
        "parent-token",
        establishedAt + EMBED_SESSION_REUSE_MS - 1,
      ),
    ).toBe(true);
    expect(
      hasLiveWorkspaceAppSession(
        "calendar",
        "parent-token",
        establishedAt + EMBED_SESSION_REUSE_MS,
      ),
    ).toBe(false);
  });

  it("does not let a different parent session token reuse another token's session", () => {
    const establishedAt = 1_000_000;
    rememberLiveWorkspaceAppSession(
      "calendar",
      "parent-token-a",
      establishedAt,
    );

    expect(
      hasLiveWorkspaceAppSession(
        "calendar",
        "parent-token-b",
        establishedAt + 1_000,
      ),
    ).toBe(false);
  });

  it("does not let a different app id reuse another app's session", () => {
    const establishedAt = 1_000_000;
    rememberLiveWorkspaceAppSession("calendar", "parent-token", establishedAt);

    expect(
      hasLiveWorkspaceAppSession("mail", "parent-token", establishedAt + 1_000),
    ).toBe(false);
  });

  it("forgets a session so a later check reports it as gone", () => {
    const establishedAt = 1_000_000;
    rememberLiveWorkspaceAppSession("calendar", "parent-token", establishedAt);
    expect(
      hasLiveWorkspaceAppSession("calendar", "parent-token", establishedAt),
    ).toBe(true);

    forgetLiveWorkspaceAppSession("calendar", "parent-token");

    expect(
      hasLiveWorkspaceAppSession("calendar", "parent-token", establishedAt),
    ).toBe(false);
  });

  // The map is keyed by a hash fingerprint (embedSessionKey), and the module
  // exposes no getter that returns a stored token — reuse only ever answers
  // true/false for a token the caller already holds. The "different token"
  // case above is the honest form of this assertion: a near-miss token gets
  // no reuse, so there is nothing recoverable to read back.
});
