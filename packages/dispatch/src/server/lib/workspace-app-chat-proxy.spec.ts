import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOrgContext: vi.fn(),
  createWorkspaceSsoEmbedSession: vi.fn(),
  createGrantedDispatchMcpEmbedSession: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return { ...actual, getSession: mocks.getSession };
});

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("./mcp-gateway.js", () => ({
  createWorkspaceSsoEmbedSession: mocks.createWorkspaceSsoEmbedSession,
  createGrantedDispatchMcpEmbedSession:
    mocks.createGrantedDispatchMcpEmbedSession,
}));

import {
  clearWorkspaceAppChatSessions,
  createWorkspaceAppChatProxyHandler,
} from "./workspace-app-chat-proxy.js";

const APP_ORIGIN = "https://analytics.agent-native.com";
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
  return { url, req: new Request(url, init) };
}

/** Upstream stub: the embed-start redirect plus whatever the chat route returns. */
function stubFetch(
  chatResponse: (
    url: string,
    init: RequestInit,
  ) => Response | Promise<Response>,
  options: { token?: string; startStatus?: number } = {},
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
          location: `/?embedded=1&__an_embed_token=${encodeURIComponent(token)}`,
        },
      });
    }
    return chatResponse(url, init);
  }) as unknown as typeof fetch;
}

describe("workspace app chat proxy", () => {
  beforeEach(() => {
    clearWorkspaceAppChatSessions();
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.getOrgContext.mockResolvedValue({ orgId: "org-1" });
    mocks.createWorkspaceSsoEmbedSession.mockResolvedValue({
      startUrl: START_URL,
      app: "analytics",
    });
    mocks.createGrantedDispatchMcpEmbedSession.mockReset();
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
      .calls[1];
    expect(chatCall[0]).toBe(`${APP_ORIGIN}/_agent-native/agent-chat`);
    const headers = chatCall[1].headers as Headers;
    expect(headers.get("authorization")).toMatch(/^Bearer /);
    expect(headers.get("x-agent-native-embed-target")).toBe("/");
    expect(headers.get("x-agent-native-csrf")).toBe("1");
    expect(headers.get("cookie")).toBeNull();
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
      .calls[1];
    expect(chatCall[0]).toBe(
      `${APP_ORIGIN}/_agent-native/agent-chat/runs/active?threadId=t-1`,
    );
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
    // The first chunk arrives while the upstream stream is still open — a
    // buffering proxy could not have produced it yet.
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

  it("reports an error when the app rejects the embed ticket exchange", async () => {
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }), {
      startStatus: 401,
    });
    const handler = createWorkspaceAppChatProxyHandler({ fetchImpl });

    const response = await handler(
      proxyEvent("/_agent-native/workspace-app-chat/analytics", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain(
      "status 401",
    );
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

    // The 401 above invalidated the cached credential.
    await send();
    expect(mocks.createWorkspaceSsoEmbedSession).toHaveBeenCalledTimes(2);
  });

  it("refuses an embed token with no readable expiry rather than guessing one", async () => {
    const fetchImpl = stubFetch(() => new Response("ok", { status: 200 }), {
      token: `${Buffer.from(JSON.stringify({ ownerEmail: "o@e.com" })).toString("base64url")}.sig`,
    });
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
});
