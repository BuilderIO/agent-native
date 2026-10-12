import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBuilderDesktopMessagesHandler,
  type BuilderDesktopMessagesProxyDependencies,
} from "./builder-desktop-messages-route.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

const PATH = "/_agent-native/builder/desktop/messages";
const EMAIL = "agent@example.test";
const ORG_ID = "org-123";
const PRIVATE_KEY = "bpk-test-private-placeholder";
const PUBLIC_KEY = "bpk-test-public-placeholder";
const OAUTH_TOKEN = "oauth-test-token-placeholder";
const MESSAGE_BODY = {
  model: "claude-sonnet-test",
  max_tokens: 1024,
  stream: true,
  messages: [{ role: "user", content: "Hello" }],
};

const fetchMock = vi.fn<typeof fetch>();

function testDependencies(
  overrides: Partial<BuilderDesktopMessagesProxyDependencies> = {},
): BuilderDesktopMessagesProxyDependencies {
  return {
    getSession: async (event) =>
      event.req.headers.get("cookie")?.includes("session=")
        ? { email: EMAIL }
        : null,
    getOrgContext: async () => ({ orgId: ORG_ID }),
    resolveGatewayAuth: async () => ({
      authorization: `Bearer ${PRIVATE_KEY}`,
      spaceId: PUBLIC_KEY,
      userId: "builder-user-123",
    }),
    getGatewayBaseUrl: () => "https://gateway.example/agent-native/gateway/v1",
    getGatewayHeaders: () => ({ "x-client-name": "@agent-native/core" }),
    fetch: fetchMock,
    ...overrides,
  };
}

function testApp(
  overrides: Partial<BuilderDesktopMessagesProxyDependencies> = {},
) {
  const app = createApp();
  app.use(
    PATH,
    createBuilderDesktopMessagesHandler(testDependencies(overrides)),
  );
  return app;
}

function request(
  body: unknown = MESSAGE_BODY,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://dispatch.example${PATH}`, {
    method: "POST",
    headers: {
      cookie: "session=authenticated",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response('event: message_start\ndata: {"type":"message_start"}\n\n', {
      headers: { "content-type": "text/event-stream" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Desktop Builder Messages proxy", () => {
  it("requires a first-party session before resolving Builder credentials", async () => {
    const resolveGatewayAuth = vi.fn(async () => null);
    const response = await testApp({ resolveGatewayAuth }).fetch(
      request(MESSAGE_BODY, { cookie: "" }),
    );

    expect(response.status).toBe(401);
    expect(resolveGatewayAuth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreadable session store as temporary instead of unauthenticated", async () => {
    const resolveGatewayAuth = vi.fn(async () => null);
    const response = await testApp({
      getSession: async () => {
        throw new Error("session store unavailable");
      },
      resolveGatewayAuth,
    }).fetch(request());

    expect(response.status).toBe(503);
    expect(await response.text()).toContain(
      "Could not read the signed-in session",
    );
    expect(resolveGatewayAuth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an explicit cross-origin request before reading credentials", async () => {
    const resolveGatewayAuth = vi.fn(async () => null);
    const response = await testApp({ resolveGatewayAuth }).fetch(
      request(MESSAGE_BODY, {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(resolveGatewayAuth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the authenticated user's active org and never returns Builder keys", async () => {
    let resolvedIdentity:
      | { userEmail: string; orgId: string | null }
      | undefined;
    const response = await testApp({
      getOrgContext: async () => ({ orgId: ORG_ID }),
      resolveGatewayAuth: async (identity) => {
        resolvedIdentity = identity;
        expect(getRequestUserEmail()).toBe(EMAIL);
        expect(getRequestOrgId()).toBe(ORG_ID);
        return {
          authorization: `Bearer ${PRIVATE_KEY}`,
          spaceId: PUBLIC_KEY,
          userId: "builder-user-123",
        };
      },
    }).fetch(
      request(MESSAGE_BODY, {
        "x-org-id": "org-attacker-controlled",
        authorization: "Bearer client-supplied-token",
        "x-builder-api-key": "client-supplied-builder-key",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const upstreamHeaders = new Headers(init.headers);
    expect(resolvedIdentity).toEqual({ userEmail: EMAIL, orgId: ORG_ID });
    expect(url.toString()).toBe(
      `https://gateway.example/agent-native/gateway/v1/messages?apiKey=${PUBLIC_KEY}`,
    );
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe(JSON.stringify(MESSAGE_BODY));
    expect(init.body as string).toContain('"stream":true');
    expect((init.signal as AbortSignal).aborted).toBe(false);
    expect(upstreamHeaders.get("authorization")).toBe(`Bearer ${PRIVATE_KEY}`);
    expect(upstreamHeaders.get("x-builder-api-key")).toBe(PUBLIC_KEY);
    expect(upstreamHeaders.get("x-builder-user-id")).toBe("builder-user-123");
    expect(upstreamHeaders.get("anthropic-version")).toBe("2023-06-01");
    expect(upstreamHeaders.get("anthropic-beta")).toBe(
      "fine-grained-tool-streaming-2025-05-14",
    );
    expect(upstreamHeaders.get("cookie")).toBeNull();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("authorization")).toBeNull();
    expect(response.headers.get("x-builder-api-key")).toBeNull();
    const responseText = await response.text();
    expect(responseText).toContain("event: message_start");
    for (const secret of [PRIVATE_KEY, PUBLIC_KEY, OAUTH_TOKEN]) {
      expect(responseText).not.toContain(secret);
      expect(JSON.stringify([...response.headers])).not.toContain(secret);
    }
  });

  it("keeps OAuth tokens server-side and does not invent a public-key header", async () => {
    const response = await testApp({
      resolveGatewayAuth: async () => ({
        authorization: `Bearer ${OAUTH_TOKEN}`,
        spaceId: null,
        userId: null,
      }),
    }).fetch(request());

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const upstreamHeaders = new Headers(init.headers);
    expect(url.searchParams.has("apiKey")).toBe(false);
    expect(upstreamHeaders.get("authorization")).toBe(`Bearer ${OAUTH_TOKEN}`);
    expect(upstreamHeaders.get("x-builder-api-key")).toBeNull();
    expect(response.headers.get("authorization")).toBeNull();
    expect(response.headers.get("x-builder-api-key")).toBeNull();
    expect(await response.text()).not.toContain(OAUTH_TOKEN);
  });

  it("only forwards streaming Messages requests", async () => {
    const app = testApp();
    const response = await app.fetch(
      request({ ...MESSAGE_BODY, stream: false }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces streaming for a valid Messages body that omits stream", async () => {
    const { stream: _stream, ...body } = MESSAGE_BODY;
    const response = await testApp().fetch(request(body));

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true });
    await response.body?.cancel();
  });

  it("streams upstream bytes and aborts the Gateway when the client cancels", async () => {
    let upstreamCancelled = false;
    let upstreamSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      upstreamSignal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("event: message_start\n\n"),
          );
        },
        cancel() {
          upstreamCancelled = true;
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await testApp().fetch(request());
    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain(
      "event: message_start",
    );

    await reader.cancel("desktop client disconnected");

    expect(upstreamCancelled).toBe(true);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("does not turn an empty Gateway success into a successful Messages response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await testApp().fetch(request());

    expect(response.status).toBe(502);
    expect(await response.text()).toContain(
      "Builder Gateway returned an empty response",
    );
  });
});
