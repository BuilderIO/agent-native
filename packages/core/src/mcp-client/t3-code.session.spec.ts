import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transports: Array<{ url: URL; options: Record<string, unknown> }> = [];
  const connect = vi.fn();
  const callTool = vi.fn();
  const close = vi.fn();
  class FakeClient {
    connect = connect;
    callTool = callTool;
    close = close;
  }
  class FakeTransport {
    constructor(url: URL, options: Record<string, unknown>) {
      transports.push({ url, options });
    }
  }
  return {
    transports,
    connect,
    callTool,
    close,
    FakeClient,
    FakeTransport,
    getUserSetting: vi.fn(),
    putUserSetting: vi.fn(),
    deleteUserSetting: vi.fn(),
    fetchMcpOriginBound: vi.fn(),
    saveCredentials: vi.fn(),
    revokeCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    getAccessToken: vi.fn(),
    getConnectionState: vi.fn(),
    markReconnect: vi.fn(),
  };
});

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: mocks.putUserSetting,
  deleteUserSetting: mocks.deleteUserSetting,
}));

vi.mock("./manager.js", () => ({
  fetchMcpOriginBound: mocks.fetchMcpOriginBound,
}));

vi.mock("./oauth-client.js", () => ({
  saveMcpOAuthCredentials: mocks.saveCredentials,
  revokeMcpOAuthCredentials: mocks.revokeCredentials,
  deleteMcpOAuthCredentials: mocks.deleteCredentials,
  getMcpOAuthAccessToken: mocks.getAccessToken,
  getMcpOAuthConnectionState: mocks.getConnectionState,
  markMcpOAuthReconnectRequired: mocks.markReconnect,
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: mocks.FakeClient,
  StreamableHTTPClientTransport: mocks.FakeTransport,
}));

import {
  T3_CODE_SETTING_KEY,
  T3CodeNotConnectedError,
  T3CodeReconnectRequiredError,
  T3CodeToolError,
  T3CodeUnreachableError,
  disconnectT3Code,
  getT3CodeConnection,
  getT3CodeStatus,
  saveT3CodeConnection,
  withT3Code,
} from "./t3-code.js";

const stored = {
  url: "https://t3.example.test/mcp",
  oauthSecretKey: "mcp_oauth:old",
  connectedAt: 1_700_000_000_000,
};

const identity = {
  key: "mcp_oauth:old",
  scope: "user",
  scopeId: "alice@example.test",
  serverUrl: "https://t3.example.test/mcp",
};

const credentials = {
  serverUrl: "https://t3.example.test/mcp",
  tokens: { access_token: "a", token_type: "Bearer" },
};

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function text(value: string) {
  return { content: [{ type: "text", text: value }] };
}

function connectedState(scope: string, tokenExpiresAt?: number) {
  return {
    kind: "connected",
    credential: {
      tokens: { scope },
      ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
    },
  };
}

beforeEach(() => {
  mocks.transports.length = 0;
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.callTool.mockReset().mockResolvedValue({ structuredContent: {} });
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.getUserSetting.mockReset().mockResolvedValue({ ...stored });
  mocks.putUserSetting.mockReset().mockResolvedValue(undefined);
  mocks.deleteUserSetting.mockReset().mockResolvedValue(true);
  mocks.fetchMcpOriginBound.mockReset().mockResolvedValue(new Response("{}"));
  mocks.saveCredentials.mockReset().mockResolvedValue(undefined);
  mocks.revokeCredentials.mockReset().mockResolvedValue(true);
  mocks.deleteCredentials.mockReset().mockResolvedValue(true);
  mocks.getAccessToken.mockReset().mockResolvedValue("token-1");
  mocks.getConnectionState
    .mockReset()
    .mockResolvedValue(
      connectedState("orchestration:read orchestration:operate"),
    );
  mocks.markReconnect.mockReset().mockResolvedValue(true);
});

describe("T3 Code connection", () => {
  it("reads a person's saved connection by their trimmed, lowercased email", async () => {
    await expect(getT3CodeConnection("  Alice@Example.Test ")).resolves.toEqual(
      stored,
    );
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "alice@example.test",
      T3_CODE_SETTING_KEY,
    );
  });

  it("treats a missing or damaged connection as none", async () => {
    mocks.getUserSetting.mockResolvedValueOnce(null);
    await expect(getT3CodeConnection("alice@example.test")).resolves.toBeNull();
    mocks.getUserSetting.mockResolvedValueOnce({ url: 1, oauthSecretKey: "k" });
    await expect(getT3CodeConnection("alice@example.test")).resolves.toBeNull();
    mocks.getUserSetting.mockResolvedValueOnce({ url: "u", oauthSecretKey: 2 });
    await expect(getT3CodeConnection("alice@example.test")).resolves.toBeNull();
    mocks.getUserSetting.mockResolvedValueOnce({
      url: "u",
      oauthSecretKey: "k",
    });
    await expect(getT3CodeConnection("alice@example.test")).resolves.toEqual({
      url: "u",
      oauthSecretKey: "k",
      connectedAt: 0,
    });
  });

  it("saves a new sign-in under a fresh key and revokes the one it replaces", async () => {
    const saved = await saveT3CodeConnection("Alice@Example.Test", {
      url: "https://t3.example.test/mcp",
      credentials,
    });
    expect(saved.url).toBe("https://t3.example.test/mcp");
    expect(saved.oauthSecretKey).toMatch(/^mcp_oauth:[0-9a-f]{16}$/);
    expect(saved.connectedAt).toBeGreaterThan(0);
    expect(mocks.saveCredentials).toHaveBeenCalledWith({
      key: saved.oauthSecretKey,
      scope: "user",
      scopeId: "alice@example.test",
      credentials,
    });
    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "alice@example.test",
      T3_CODE_SETTING_KEY,
      saved,
    );
    expect(mocks.revokeCredentials).toHaveBeenCalledWith(identity);
    expect(mocks.deleteCredentials).not.toHaveBeenCalled();
  });

  it("deletes the old sign-in when T3 won't revoke it, and revokes nothing on a first connect", async () => {
    mocks.revokeCredentials.mockRejectedValueOnce(new Error("offline"));
    await saveT3CodeConnection("alice@example.test", {
      url: "https://t3.example.test/mcp",
      credentials,
    });
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(identity);

    mocks.revokeCredentials.mockClear();
    mocks.getUserSetting.mockResolvedValueOnce(null);
    await saveT3CodeConnection("alice@example.test", {
      url: "https://t3.example.test/mcp",
      credentials,
    });
    expect(mocks.revokeCredentials).not.toHaveBeenCalled();
  });

  it("disconnects by forgetting the connection and revoking its sign-in", async () => {
    await expect(disconnectT3Code(" Alice@Example.Test")).resolves.toEqual({
      disconnected: true,
    });
    expect(mocks.deleteUserSetting).toHaveBeenCalledWith(
      "alice@example.test",
      T3_CODE_SETTING_KEY,
    );
    expect(mocks.revokeCredentials).toHaveBeenCalledWith(identity);

    mocks.revokeCredentials.mockRejectedValueOnce(new Error("offline"));
    mocks.deleteCredentials.mockRejectedValueOnce(new Error("offline"));
    await expect(disconnectT3Code("alice@example.test")).resolves.toEqual({
      disconnected: true,
    });
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(identity);
  });

  it("has nothing to disconnect when there is no connection", async () => {
    mocks.getUserSetting.mockResolvedValueOnce(null);
    await expect(disconnectT3Code("alice@example.test")).resolves.toEqual({
      disconnected: false,
    });
    expect(mocks.deleteUserSetting).not.toHaveBeenCalled();
  });
});

describe("withT3Code", () => {
  it("asks for a connection first, then a live sign-in", async () => {
    mocks.getUserSetting.mockResolvedValueOnce(null);
    await expect(
      withT3Code("alice@example.test", async () => "never"),
    ).rejects.toBeInstanceOf(T3CodeNotConnectedError);
    mocks.getAccessToken.mockResolvedValueOnce(null);
    await expect(
      withT3Code("alice@example.test", async () => "never"),
    ).rejects.toBeInstanceOf(T3CodeReconnectRequiredError);
    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      ...identity,
      throwOnTransientRefreshFailure: true,
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("calls T3 with the person's own token, held to T3's origin", async () => {
    mocks.callTool.mockResolvedValueOnce({ structuredContent: { ok: 1 } });
    const result = await withT3Code("alice@example.test", (call) =>
      call("t3_thread_list", { limit: 2 }),
    );
    expect(result).toEqual({ ok: 1 });
    expect(mocks.callTool).toHaveBeenCalledWith({
      name: "t3_thread_list",
      arguments: { limit: 2 },
    });
    expect(mocks.transports).toHaveLength(1);
    const [transport] = mocks.transports;
    expect(String(transport.url)).toBe("https://t3.example.test/mcp");
    expect(transport.options.requestInit).toEqual({
      headers: { Authorization: "Bearer token-1" },
    });
    const fetcher = transport.options.fetch as (
      input: string,
      init: RequestInit,
    ) => Promise<Response>;
    await fetcher("https://t3.example.test/mcp", { method: "POST" });
    expect(mocks.fetchMcpOriginBound).toHaveBeenCalledWith(
      "https://t3.example.test/mcp",
      { method: "POST" },
      "https://t3.example.test",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("reads JSON or plain text from a text answer", async () => {
    mocks.callTool
      .mockResolvedValueOnce({
        content: [
          { type: "text", text: '{"threads":' },
          { type: "image", data: "x" },
          null,
          { type: "text", text: "[]}" },
        ],
      })
      .mockResolvedValueOnce(text("plain words"))
      .mockResolvedValueOnce({ structuredContent: "not an object" });
    const values = await withT3Code("alice@example.test", async (call) => [
      await call("a", {}),
      await call("b", {}),
      await call("c", {}),
    ]);
    expect(values).toEqual([
      { threads: [] },
      { text: "plain words" },
      { text: "" },
    ]);
  });

  it("passes on T3's own reason when a tool refuses", async () => {
    mocks.callTool
      .mockResolvedValueOnce({
        isError: true,
        ...text('{"error":"No such thread"}'),
      })
      .mockResolvedValueOnce({
        isError: true,
        structuredContent: { message: "Busy" },
      })
      .mockResolvedValueOnce({ isError: true, ...text("x".repeat(600)) })
      .mockResolvedValueOnce({
        isError: true,
        structuredContent: { error: "" },
      });
    const errors: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      errors.push(
        await withT3Code("alice@example.test", (call) => call("t", {})).then(
          () => null,
          (error: unknown) => error,
        ),
      );
    }
    expect(errors.every((error) => error instanceof T3CodeToolError)).toBe(
      true,
    );
    const reasons = errors.map((error) => (error as Error).message);
    expect(reasons).toEqual([
      "No such thread",
      "Busy",
      "x".repeat(500),
      "T3 Code refused the request.",
    ]);
  });

  it("marks the sign-in for Reconnect when T3 refuses it", async () => {
    mocks.connect.mockRejectedValueOnce(httpError(401));
    await expect(
      withT3Code("alice@example.test", async () => "never"),
    ).rejects.toBeInstanceOf(T3CodeReconnectRequiredError);
    expect(mocks.markReconnect).toHaveBeenCalledWith(identity);
    expect(mocks.close).toHaveBeenCalledTimes(1);

    mocks.callTool.mockRejectedValueOnce(httpError(403));
    mocks.markReconnect.mockRejectedValueOnce(new Error("db down"));
    await expect(
      withT3Code("alice@example.test", (call) => call("t", {})),
    ).rejects.toBeInstanceOf(T3CodeReconnectRequiredError);
    expect(mocks.markReconnect).toHaveBeenCalledTimes(2);
  });

  it("says T3 can't be reached for any other failure, and keeps its own errors", async () => {
    mocks.connect.mockRejectedValueOnce(httpError(500));
    mocks.close.mockRejectedValueOnce(new Error("already closed"));
    await expect(
      withT3Code("alice@example.test", async () => "never"),
    ).rejects.toBeInstanceOf(T3CodeUnreachableError);

    mocks.callTool.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      withT3Code("alice@example.test", (call) => call("t", {})),
    ).rejects.toBeInstanceOf(T3CodeUnreachableError);

    await expect(
      withT3Code("alice@example.test", async () => {
        throw new T3CodeReconnectRequiredError();
      }),
    ).rejects.toBeInstanceOf(T3CodeReconnectRequiredError);
    expect(mocks.markReconnect).not.toHaveBeenCalled();
  });

  it("gives up on a T3 that doesn't answer in time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.connect.mockReturnValueOnce(new Promise(() => undefined));
      const pending = withT3Code("alice@example.test", async () => "never");
      const outcome = pending.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());
      expect(mocks.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await outcome).toBeInstanceOf(T3CodeUnreachableError);
      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getT3CodeStatus", () => {
  const capabilities = {
    providers: [
      {
        providerInstanceId: "claude-main",
        driverKind: "claudeAgent",
        models: [{ id: "claude-opus-5-5" }],
        constraints: [],
      },
    ],
  };

  it("is disconnected with no saved connection", async () => {
    mocks.getUserSetting.mockResolvedValueOnce(null);
    await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
      state: "disconnected",
      agents: [],
    });
  });

  it("asks for Reconnect when the sign-in is gone or refused", async () => {
    for (const kind of ["missing", "reconnect_required", "malformed"]) {
      mocks.getConnectionState.mockResolvedValueOnce({ kind });
      await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
        url: stored.url,
        agents: [],
        state: "reconnect",
      });
    }
    expect(mocks.getConnectionState).toHaveBeenCalledWith(identity);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("reports the computer, access, agents and sign-in expiry when connected", async () => {
    mocks.getConnectionState.mockResolvedValueOnce(
      connectedState(
        "orchestration:read  orchestration:operate",
        1_800_000_000_000,
      ),
    );
    mocks.callTool
      .mockResolvedValueOnce({ structuredContent: { label: "Studio" } })
      .mockResolvedValueOnce({ structuredContent: capabilities });
    await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
      url: stored.url,
      state: "connected",
      computer: "Studio",
      access: "operate",
      agents: [
        {
          kind: "claude-code",
          name: "Claude Code",
          providerInstanceId: "claude-main",
          model: "claude-opus-5-5",
        },
      ],
      expiresAt: 1_800_000_000_000,
    });
    expect(mocks.callTool.mock.calls.map(([request]) => request.name)).toEqual([
      "t3_environment_read",
      "orchestrator_capabilities",
    ]);
  });

  it("can only look when the sign-in lacks the operate scope, even expired", async () => {
    mocks.getConnectionState.mockResolvedValueOnce({
      kind: "expired",
      credential: { tokens: {} },
    });
    mocks.callTool
      .mockResolvedValueOnce({ structuredContent: { label: 7 } })
      .mockResolvedValueOnce({ structuredContent: { providers: [] } });
    await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
      url: stored.url,
      state: "connected",
      access: "read",
      agents: [],
    });
  });

  it("is unreachable when T3 doesn't answer, and Reconnect when it refuses", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
      url: stored.url,
      agents: [],
      state: "unreachable",
      access: "operate",
    });
    mocks.connect.mockRejectedValueOnce(httpError(401));
    await expect(getT3CodeStatus("alice@example.test")).resolves.toEqual({
      url: stored.url,
      agents: [],
      state: "reconnect",
    });
  });
});
