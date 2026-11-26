import { getRequestContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getRequestIdentityAuthenticatedAtMs: vi.fn(),
  getOrgContext: vi.fn(),
  getAppProductionUrl: vi.fn(),
  getForwardedRequestOrigin: vi.fn(),
  resolveAppRuntimeUrl: vi.fn(),
  createWorkspaceSsoEmbedSession: vi.fn(),
  createGrantedDispatchMcpEmbedSession: vi.fn(),
  createWorkspaceSsoEmbedSessionForWorkspaceAppChat: vi.fn(),
  createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getAppProductionUrl: mocks.getAppProductionUrl,
    getForwardedRequestOrigin: mocks.getForwardedRequestOrigin,
    getSession: mocks.getSession,
    getRequestIdentityAuthenticatedAtMs:
      mocks.getRequestIdentityAuthenticatedAtMs,
    resolveAppRuntimeUrl: mocks.resolveAppRuntimeUrl,
  };
});

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("./mcp-gateway.js", () => ({
  createWorkspaceSsoEmbedSession: mocks.createWorkspaceSsoEmbedSession,
  createGrantedDispatchMcpEmbedSession:
    mocks.createGrantedDispatchMcpEmbedSession,
  createWorkspaceSsoEmbedSessionForWorkspaceAppChat:
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
  createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat:
    mocks.createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat,
}));

import {
  clearWorkspaceAppChatSessions,
  exchangeEmbedStartUrl,
  createWorkspaceAppChatProxyHandler,
} from "./workspace-app-chat-proxy.js";

type WorkspaceAppChatProxyEvent = Parameters<
  ReturnType<typeof createWorkspaceAppChatProxyHandler>
>[0];

const APP_ORIGIN = "https://analytics.agent-native.com";
const WORKSPACE_ORIGIN = "https://beta.agent-workspace.builder.io";
const START_URL = `${APP_ORIGIN}/_agent-native/embed/start?ticket=ticket-1`;

function embedToken(expiresInSeconds = 3600): string {
  const payload = Buffer.from(
    JSON.stringify({
      kind: "agent-native-embed-session",
      ownerEmail: "owner@example.com",
      targetPath: "/",
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  ).toString("base64url");
  return `${payload}.signature`;
}

function proxyEvent(path: string, init: RequestInit = {}) {
  const url = new URL(`https://dispatch.agent-native.com${path}`);
  return { url, req: new Request(url, init) } as WorkspaceAppChatProxyEvent;
}

function mountedProxyEvent(
  mountedPath: string,
  strippedPath: string,
  init: RequestInit = {},
) {
  const url = new URL(`https://dispatch.agent-native.com${strippedPath}`);
  return {
    url,
    req: new Request(url, init),
    context: { _mountedPathname: mountedPath },
  } as WorkspaceAppChatProxyEvent;
}

function stubFetch(
  chatResponse: (
    url: string,
    init: RequestInit,
  ) => Response | Promise<Response>,
  options: {
    token?: string;
    startStatus?: number;
    redirectLocation?: (token: string) => string;
  } = {},
) {
  return vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.includes("/_agent-native/embed/start")) {
      if (options.startStatus && options.startStatus >= 400) {
        return new Response("expired", { status: options.startStatus });
      }
      const token = options.token ?? embedToken();
      return new Response("", {
        status: 302,
        headers: {
          location:
            options.redirectLocation?.(token) ??
            `/?embedded=1&__an_embed_token=${encodeURIComponent(token)}`,
        },
      });
    }
    return chatResponse(url, init);
  }) as unknown as typeof fetch;
}

describe("workspace app chat proxy", () => {
  beforeEach(() => {
    clearWorkspaceAppChatSessions();
    mocks.getRequestIdentityAuthenticatedAtMs.mockReturnValue(1700000000000);
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.getOrgContext.mockResolvedValue({ orgId: "org-1" });
    mocks.getAppProductionUrl.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    mocks.getForwardedRequestOrigin.mockReturnValue(
      "https://dispatch.agent-native.com",
    );
    mocks.resolveAppRuntimeUrl.mockReturnValue(
      "https://workspace.agent-native.com/dispatch",
    );
    mocks.createWorkspaceSsoEmbedSession.mockResolvedValue({
      startUrl: START_URL,
      app: "analytics",
    });
    mocks.createGrantedDispatchMcpEmbedSession.mockReset();
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockImplementation(
      async (appId: string) => {
        const result = await mocks.createWorkspaceSsoEmbedSession({
          app: appId,
          path: "/",
          chrome: "minimal",
        });
        return {
          token: embedToken(),
          expiresAt: Date.now() + 3600000,
          targetPath: "/",
          appBaseUrl: new URL(result.startUrl).origin,
        };
      },
    );
    mocks.createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat.mockImplementation(
      async (appId: string) => {
        const result = await mocks.createGrantedDispatchMcpEmbedSession({
          app: appId,
          path: "/",
          chrome: "minimal",
        });
        return {
          token: embedToken(),
          expiresAt: Date.now() + 3600000,
          targetPath: "/",
          appBaseUrl: new URL(result.startUrl).origin,
        };
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("forwards a chat turn to the target app's own agent-chat route", async () => {
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const chatCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(chatCall[0]).toBe(`${APP_ORIGIN}/_agent-native/agent-chat`);
    const headers = chatCall[1].headers as Headers;
    expect(headers.get("authorization")).toMatch(/^Bearer /);
    expect(headers.get("x-agent-native-embed-target")).toBeNull();
    expect(headers.get("x-agent-native-csrf")).toBe("1");
    expect(headers.get("cookie")).toBeNull();
  });

  it("forwards chat through the Workspace app mount returned by embed exchange", async () => {
    const appId = "customer-ticket-triage";
    const appBaseUrl = `${WORKSPACE_ORIGIN}/dispatch/apps/${appId}`;
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockResolvedValue({
      token: embedToken(),
      expiresAt: Date.now() + 3600000,
      targetPath: "/",
      appBaseUrl,
    });
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }), {
      redirectLocation: (token) =>
        `/dispatch/apps/${appId}/?embedded=1&__an_embed_token=${encodeURIComponent(token)}`,
    });
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent(`/_agent-native/workspace-app-chat/${appId}`, {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const chatCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(chatCall[0]).toBe(`${appBaseUrl}/_agent-native/agent-chat`);
    expect(
      (chatCall[1].headers as Headers).get("x-agent-native-embed-target"),
    ).toBeNull();
  });

  it.each([
    [
      "a sibling app",
      "/dispatch/apps/other-app/?__an_embed_token=token",
      "outside its app mount",
    ],
    [
      "encoded traversal",
      "/dispatch/apps/customer-ticket-triage%2F..%2Fother-app/?__an_embed_token=token",
      "outside its app mount",
    ],
    [
      "another origin",
      "https://attacker.example/?__an_embed_token=token",
      "untrusted origin",
    ],
  ])(
    "keeps document exchange from sending an embed token to %s",
    async (_name, location, error) => {
      const fetchImpl = stubFetch(() => new Response("unexpected"), {
        redirectLocation: () => location,
      });
      await expect(
        exchangeEmbedStartUrl(
          `${WORKSPACE_ORIGIN}/dispatch/_agent-native/embed/start?ticket=ticket-1`,
          `${WORKSPACE_ORIGIN}/dispatch/apps/customer-ticket-triage`,
          fetchImpl,
        ),
      ).rejects.toThrow(error);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("allows an encoded app mount when the redirect preserves that mount", async () => {
    const appId = "customer-ticket-triage";
    const appBaseUrl = `${WORKSPACE_ORIGIN}/dispatch/apps/customer%20ticket-triage`;
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockResolvedValue({
      token: embedToken(),
      expiresAt: Date.now() + 3600000,
      targetPath: "/",
      appBaseUrl,
    });
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }), {
      redirectLocation: (token) =>
        `/dispatch/apps/customer%20ticket-triage/?embedded=1&__an_embed_token=${encodeURIComponent(token)}`,
    });
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent(`/_agent-native/workspace-app-chat/${appId}`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const chatCall = fetchImpl.mock.calls[0];
    expect(chatCall[0]).toBe(`${appBaseUrl}/_agent-native/agent-chat`);
  });

  it("preserves a configured request origin for both embed-session signing paths", async () => {
    const requestOrigin = "https://dispatch.agent-native.com";
    mocks.createWorkspaceSsoEmbedSession.mockImplementation(async () => {
      expect(getRequestContext()?.requestOrigin).toBe(requestOrigin);
      throw new Error("Workspace sign-in is not configured for this app.");
    });
    mocks.createGrantedDispatchMcpEmbedSession.mockImplementation(async () => {
      expect(getRequestContext()?.requestOrigin).toBe(requestOrigin);
      return { startUrl: START_URL, app: "analytics" };
    });
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok", { status: 200 })),
    });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getForwardedRequestOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.createGrantedDispatchMcpEmbedSession).toHaveBeenCalledTimes(1);
  });

  it("accepts a request origin from the configured runtime URL", async () => {
    const runtimeOrigin = "https://workspace.agent-native.com";
    mocks.getForwardedRequestOrigin.mockReturnValue(runtimeOrigin);
    const observedOrigins: string[] = [];
    mocks.createWorkspaceSsoEmbedSession.mockImplementation(async () => {
      observedOrigins.push(getRequestContext()?.requestOrigin ?? "");
      return { startUrl: START_URL, app: "analytics" };
    });
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok", { status: 200 })),
    });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics"),
    );

    expect(response.status).toBe(200);
    expect(observedOrigins).toEqual([runtimeOrigin]);
  });

  it("ignores untrusted forwarded origins for context and session caching", async () => {
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      token: "verified-session",
    });
    const requestOrigins = [
      "https://attacker-one.example",
      "https://attacker-two.example",
    ];
    const observedOrigins: string[] = [];
    mocks.getForwardedRequestOrigin
      .mockReturnValueOnce(requestOrigins[0])
      .mockReturnValueOnce(requestOrigins[1]);
    mocks.createWorkspaceSsoEmbedSession.mockImplementation(async () => {
      observedOrigins.push(getRequestContext()?.requestOrigin ?? "");
      return { startUrl: START_URL, app: "analytics" };
    });
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok", { status: 200 })),
    });
    const send = () =>
      handler(proxyEvent("/_agent-native/workspace-app-chat/analytics"));

    await send();
    await send();

    expect(observedOrigins).toEqual(["https://dispatch.agent-native.com"]);
    expect(mocks.createWorkspaceSsoEmbedSession).toHaveBeenCalledTimes(1);
  });

  it("uses a valid runtime origin when the configured production URL is invalid", async () => {
    mocks.getAppProductionUrl.mockReturnValue("not-a-url");
    mocks.getForwardedRequestOrigin.mockReturnValue("https://attacker.example");
    const observedOrigins: string[] = [];
    mocks.createWorkspaceSsoEmbedSession.mockImplementation(async () => {
      observedOrigins.push(getRequestContext()?.requestOrigin ?? "");
      return { startUrl: START_URL, app: "analytics" };
    });
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok", { status: 200 })),
    });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics"),
    );

    expect(response.status).toBe(200);
    expect(observedOrigins).toEqual(["https://workspace.agent-native.com"]);
  });

  it("returns a JSON error when no trusted origin is configured", async () => {
    mocks.getAppProductionUrl.mockReturnValue("not-a-url");
    mocks.resolveAppRuntimeUrl.mockReturnValue(undefined);
    mocks.getForwardedRequestOrigin.mockReturnValue("https://attacker.example");
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok", { status: 200 })),
    });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(
        "Configured application origin is invalid.",
      ),
    });
  });

  it("forwards agent-chat sub-paths and query strings unchanged", async () => {
    const fetchImpl = stubFetch(() => new Response("[]", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    await handler(
      proxyEvent(
        "/_agent-native/workspace-app-chat/analytics/runs/active?threadId=t-1",
      ),
    );

    const chatCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(chatCall[0]).toBe(
      `${APP_ORIGIN}/_agent-native/agent-chat/runs/active?threadId=t-1`,
    );
  });

  it("parses the full path preserved by the framework mount middleware", async () => {
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      mountedProxyEvent(
        "/_agent-native/workspace-app-chat/analytics/mode",
        "/mode",
      ),
    );

    expect(response.status).toBe(200);
    const chatCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(chatCall[0]).toBe(`${APP_ORIGIN}/_agent-native/agent-chat/mode`);
  });

  it("streams the app's response through instead of buffering it", async () => {
    let emitSecondChunk: (() => void) | undefined;
    const secondChunk = new Promise<void>((resolve) => {
      emitSecondChunk = resolve;
    });
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("first"));
        await secondChunk;
        controller.enqueue(encoder.encode("second"));
        controller.close();
      },
    });
    const fetchImpl = stubFetch(
      () =>
        new Response(upstreamBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics/runs/r-1/events"),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first");

    emitSecondChunk!();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("second");
    expect((await reader.read()).done).toBe(true);
  });

  it("falls back to the Dispatch app-grant mint before giving up", async () => {
    mocks.createWorkspaceSsoEmbedSession.mockRejectedValue(
      new Error("Dispatch workspace sign-in is not enabled."),
    );
    mocks.createGrantedDispatchMcpEmbedSession.mockResolvedValue({
      startUrl: START_URL,
      app: "analytics",
    });
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createGrantedDispatchMcpEmbedSession).toHaveBeenCalled();
  });

  it("reports an error and never answers from Dispatch's own agent when no app session can be minted", async () => {
    mocks.createWorkspaceSsoEmbedSession.mockRejectedValue(
      new Error("Dispatch workspace sign-in is not enabled."),
    );
    mocks.createGrantedDispatchMcpEmbedSession.mockRejectedValue(
      new Error('Unknown app "analytics".'),
    );
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain(
      "analytics chat is unavailable",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retains rejection of a document ticket exchange denied by the app", async () => {
    const fetchImpl = stubFetch(() => new Response("ok"), { startStatus: 401 });
    await expect(
      exchangeEmbedStartUrl(START_URL, APP_ORIGIN, fetchImpl),
    ).rejects.toThrow("status 401");
  });

  it("reports an error when the app's server is unreachable", async () => {
    const fetchImpl = stubFetch(() => {
      throw new Error("fetch failed");
    });
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain(
      "did not respond",
    );
  });

  it("requires a signed-in Dispatch user", async () => {
    mocks.getSession.mockResolvedValue(null);
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a request with no app segment instead of proxying somewhere", async () => {
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat"),
    );

    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reuses one app session across requests and re-mints after a rejection", async () => {
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      token: "verified-session",
    });
    const chatStatuses = [200, 401, 200];
    let call = 0;
    const fetchImpl = stubFetch(
      () => new Response("ok", { status: chatStatuses[call++] ?? 200 }),
    );
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });
    const send = () =>
      handler(
        proxyEvent("/_agent-native/workspace-app-chat/analytics", {
          method: "POST",
        }),
      );

    await send();
    await send();
    expect(mocks.createWorkspaceSsoEmbedSession).toHaveBeenCalledTimes(1);

    await send();
    expect(mocks.createWorkspaceSsoEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("does not retain token-less sessions, even when authentication timestamps repeat", async () => {
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok")),
    });
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await handler(
            proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(3);
  });

  it("bounds retained sessions and evicts the oldest when the cache fills", async () => {
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok")),
    });
    const send = async (token: string) => {
      mocks.getSession.mockResolvedValue({ email: "owner@example.com", token });
      expect(
        (
          await handler(
            proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
          )
        ).status,
      ).toBe(200);
    };
    for (let i = 0; i < 129; i++) await send(`verified-session-${i}`);
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(129);
    await send("verified-session-128");
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(129);
    await send("verified-session-0");
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(130);
  });

  it("sweeps expired entries before evicting a live session", async () => {
    let now = 1800000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const handler = createWorkspaceAppChatProxyHandler({
      fetchImpl: stubFetch(() => new Response("ok")),
    });
    const send = async (token: string) => {
      mocks.getSession.mockResolvedValue({ email: "owner@example.com", token });
      expect(
        (
          await handler(
            proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
          )
        ).status,
      ).toBe(200);
    };
    await send("oldest-live");
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockResolvedValueOnce(
      {
        appBaseUrl: APP_ORIGIN,
        token: embedToken(301),
        expiresAt: now + 301000,
      },
    );
    await send("short-lived");
    for (let i = 0; i < 126; i++) await send(`other-live-${i}`);
    now += 302000;
    await send("new-live");
    await send("oldest-live");
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(129);
    await send("short-lived");
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(130);
  });

  it("refuses an embed token with no readable expiry rather than guessing one", async () => {
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockResolvedValue({
      appBaseUrl: APP_ORIGIN,
      expiresAt: Date.now() + 3600000,
      token: `${Buffer.from(JSON.stringify({ ownerEmail: "o@e.com" })).toString("base64url")}.sig`,
    });
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain(
      "no usable expiry",
    );
  });
  it("does not expose the server-held chat credential or request a browser embed redirect", async () => {
    const token = embedToken();
    mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockResolvedValue({
      token,
      expiresAt: Date.now() + 3600000,
      appBaseUrl: APP_ORIGIN,
      targetPath: "/",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response("ok", { headers: { "set-cookie": `chat=${token}` } }),
    );
    const response = await createWorkspaceAppChatProxyHandler({ fetchImpl })(
      proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${APP_ORIGIN}/_agent-native/agent-chat/mode`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("ok");
  });

  it("does not reuse a cached grant after re-authentication", async () => {
    const fetchImpl = stubFetch(() => new Response("ok"));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });
    expect(
      (
        await handler(
          proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
        )
      ).status,
    ).toBe(200);
    mocks.getRequestIdentityAuthenticatedAtMs.mockReturnValue(1700000001000);
    expect(
      (
        await handler(
          proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
        )
      ).status,
    ).toBe(200);
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(2);
  });

  it("refuses chat when the authenticated identity has no sign-in provenance", async () => {
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.getRequestIdentityAuthenticatedAtMs.mockReturnValue(undefined);
    const fetchImpl = vi.fn();
    const response = await createWorkspaceAppChatProxyHandler({ fetchImpl })(
      proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
    );
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).not.toHaveBeenCalled();
    expect(
      mocks.createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat,
    ).not.toHaveBeenCalled();
  });
  it("reuses a stable verified session despite per-request authentication timestamps, then isolates re-login", async () => {
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      token: "verified-session-one",
    });
    const fetchImpl = stubFetch(() => new Response("ok"));
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });
    const request = () =>
      handler(proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"));
    expect((await request()).status).toBe(200);
    mocks.getRequestIdentityAuthenticatedAtMs.mockReturnValue(1700000001000);
    expect((await request()).status).toBe(200);
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(1);
    mocks.getSession.mockResolvedValue({
      email: "owner@example.com",
      token: "verified-session-two",
    });
    expect((await request()).status).toBe(200);
    expect(
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
    ).toHaveBeenCalledTimes(2);
  });

  it.each([
    Object.assign(new Error("Refused"), { status: 401 }),
    Object.assign(new Error("Refused"), { status: 403 }),
    Object.assign(new Error("Refused"), { statusCode: 403 }),
    Object.assign(new Error("Refused"), {
      name: "TargetMcpAuthenticationRejectedError",
    }),
  ])(
    "never retries a refused private mint through an app grant: %o",
    async (refusal) => {
      mocks.createWorkspaceSsoEmbedSessionForWorkspaceAppChat.mockRejectedValue(
        refusal,
      );
      mocks.createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat.mockResolvedValue(
        {
          token: embedToken(),
          expiresAt: Date.now() + 3600000,
          appBaseUrl: APP_ORIGIN,
          targetPath: "/",
        },
      );
      const fetchImpl = stubFetch(() => new Response("ok"));
      const response = await createWorkspaceAppChatProxyHandler({ fetchImpl })(
        proxyEvent("/_agent-native/workspace-app-chat/analytics/mode"),
      );
      expect(response.status).toBe(502);
      expect(
        mocks.createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat,
      ).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
