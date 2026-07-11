import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  A2AClient,
  A2ATaskTimeoutError,
  callAgent,
  signA2AToken,
} from "./client.js";

describe("A2AClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("uses the A2A endpoint advertised by the agent card", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        expect(url).toBe("https://agent.test/.well-known/agent-card.json");
        return new Response(
          JSON.stringify({
            name: "Standard Agent",
            description: "Uses the conventional A2A endpoint",
            url: "https://agent.test/a2a",
            version: "1.0.0",
            protocolVersion: "0.3",
            capabilities: {},
            skills: [],
          }),
          { status: 200 },
        );
      }

      expect(url).toBe("https://agent.test/a2a");
      const body = JSON.parse(String(init.body));
      return completedResponse(body, "hello from standard a2a");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).resolves.toBe("hello from standard a2a");

    const postUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url]) => url);
    expect(postUrls).toEqual(["https://agent.test/a2a"]);
  });

  it("falls back to /a2a when the agent-native endpoint is absent", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method !== "POST")
        return new Response("not found", { status: 404 });
      if (url === "https://agent.test/_agent-native/a2a") {
        return new Response("not found", { status: 404 });
      }
      expect(url).toBe("https://agent.test/a2a");
      const body = JSON.parse(String(init.body));
      return completedResponse(body, "fallback ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).resolves.toBe("fallback ok");

    const postUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url]) => url);
    expect(postUrls).toEqual([
      "https://agent.test/_agent-native/a2a",
      "https://agent.test/a2a",
    ]);
  });

  it("throws structured timeout errors with the remote task id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                id: "task-qa",
                status: { state: "working" },
                history: [],
                artifacts: [],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-qa",
              status: { state: "working" },
              history: [],
              artifacts: [],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const client = new A2AClient("https://agent.test");
    await expect(
      client.sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 1, pollIntervalMs: 1 },
      ),
    ).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-qa",
      lastState: "working",
      timeoutMs: 1,
    });

    await expect(
      client.sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 1, pollIntervalMs: 1 },
      ),
    ).rejects.toBeInstanceOf(A2ATaskTimeoutError);
  });

  it("returns receiver-verified recoverable artifact text when callAgent times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-deck");
        }
        return workingResponse(body, "task-deck", {
          message: {
            role: "agent",
            metadata: { agentNativeRecoverableArtifacts: true },
            parts: [
              {
                type: "text",
                text: "Artifacts:\n- Deck: https://slides.agent.test/deck/deck-real (ID: deck-real)",
              },
            ],
          },
        });
      }),
    );

    const result = callAgent("https://slides.agent.test", "make a deck", {
      timeoutMs: 3,
      pollIntervalMs: 1,
    });
    const assertion = expect(result).resolves.toContain(
      "https://slides.agent.test/deck/deck-real",
    );

    await assertion;
  });

  it("preserves the timeout task when recoverable artifacts are disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-deck-continuation");
        }
        return workingResponse(body, "task-deck-continuation", {
          message: {
            role: "agent",
            metadata: { agentNativeRecoverableArtifacts: true },
            parts: [
              {
                type: "text",
                text: "Artifacts:\n- Deck: https://slides.agent.test/deck/deck-real (ID: deck-real)",
              },
            ],
          },
        });
      }),
    );

    await expect(
      callAgent("https://slides.agent.test", "make a deck", {
        timeoutMs: 3,
        pollIntervalMs: 1,
        returnRecoverableArtifactsOnTimeout: false,
      }),
    ).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-deck-continuation",
    });
  });

  it("does not treat unmarked timeout text as a recoverable artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-fake");
        }
        return workingResponse(body, "task-fake", {
          message: {
            role: "agent",
            parts: [
              {
                type: "text",
                text: "Maybe try https://slides.agent.test/deck/deck-guessed",
              },
            ],
          },
        });
      }),
    );

    const result = callAgent("https://slides.agent.test", "make a deck", {
      timeoutMs: 3,
      pollIntervalMs: 1,
    });
    const assertion = expect(result).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-fake",
    });

    await assertion;
  });

  it("can prefer the shared global A2A secret before an org secret", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";

    const token = await signA2AToken(
      "alice+qa@agent-native.test",
      "builder.io",
      "org-a2a-secret",
      { preferGlobalSecret: true },
    );

    await expect(
      jose.jwtVerify(token, new TextEncoder().encode("global-a2a-secret")),
    ).resolves.toMatchObject({
      payload: {
        sub: "alice+qa@agent-native.test",
        org_domain: "builder.io",
      },
    });
    await expect(
      jose.jwtVerify(token, new TextEncoder().encode("org-a2a-secret")),
    ).rejects.toThrow();
  });

  it("auto-signs delegated calls with the shared secret before an org secret", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    let bearerToken = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        bearerToken = String(
          new Headers(init.headers).get("authorization") ?? "",
        ).replace(/^Bearer\s+/i, "");
        const body = JSON.parse(String(init.body));
        return completedResponse(body, "signed with shared secret");
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        async: false,
        userEmail: "alice+qa@agent-native.test",
        orgDomain: "builder.io",
        orgSecret: "org-a2a-secret",
      }),
    ).resolves.toBe("signed with shared secret");

    await expect(
      jose.jwtVerify(
        bearerToken,
        new TextEncoder().encode("global-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: {
        sub: "alice+qa@agent-native.test",
        org_domain: "builder.io",
      },
    });
    await expect(
      jose.jwtVerify(bearerToken, new TextEncoder().encode("org-a2a-secret")),
    ).rejects.toThrow();
  });

  it("retries delegated calls with the org secret if the shared token is rejected", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    const bearerTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        bearerTokens.push(
          String(new Headers(init.headers).get("authorization") ?? "").replace(
            /^Bearer\s+/i,
            "",
          ),
        );
        const body = JSON.parse(String(init.body));
        if (bearerTokens.length === 1) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32001, message: "Invalid or expired A2A token" },
            }),
            { status: 401 },
          );
        }
        return completedResponse(body, "signed with fallback org secret");
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        async: false,
        userEmail: "alice+qa@agent-native.test",
        orgDomain: "builder.io",
        orgSecret: "org-a2a-secret",
      }),
    ).resolves.toBe("signed with fallback org secret");

    expect(bearerTokens).toHaveLength(2);
    await expect(
      jose.jwtVerify(
        bearerTokens[0],
        new TextEncoder().encode("global-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: { sub: "alice+qa@agent-native.test" },
    });
    await expect(
      jose.jwtVerify(
        bearerTokens[1],
        new TextEncoder().encode("org-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: {
        sub: "alice+qa@agent-native.test",
        org_domain: "builder.io",
      },
    });
  });

  it("retries async task polling with fallback delegated bearer tokens", async () => {
    process.env.A2A_SECRET = "global-a2a-secret";
    const calls: Array<{ method: string; token: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        const token = String(
          new Headers(init.headers).get("authorization") ?? "",
        ).replace(/^Bearer\s+/i, "");
        const body = JSON.parse(String(init.body));
        calls.push({ method: body.method, token });
        if (body.method === "message/send") {
          return workingResponse(body, "task-auth-fallback");
        }

        const verifiedByOrgSecret = await jose
          .jwtVerify(token, new TextEncoder().encode("org-a2a-secret"))
          .then(() => true)
          .catch(() => false);
        if (!verifiedByOrgSecret) {
          return new Response("Invalid or expired A2A token", { status: 401 });
        }
        return completedResponse(body, "polled with fallback org secret");
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        userEmail: "alice+qa@agent-native.test",
        orgDomain: "builder.io",
        orgSecret: "org-a2a-secret",
        timeoutMs: 25,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe("polled with fallback org secret");

    expect(calls.map((call) => call.method)).toEqual([
      "message/send",
      "tasks/get",
      "tasks/get",
    ]);
    await expect(
      jose.jwtVerify(
        calls[0]!.token,
        new TextEncoder().encode("global-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: { sub: "alice+qa@agent-native.test" },
    });
    await expect(
      jose.jwtVerify(
        calls[1]!.token,
        new TextEncoder().encode("global-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: { sub: "alice+qa@agent-native.test" },
    });
    await expect(
      jose.jwtVerify(
        calls[2]!.token,
        new TextEncoder().encode("org-a2a-secret"),
      ),
    ).resolves.toMatchObject({
      payload: {
        sub: "alice+qa@agent-native.test",
        org_domain: "builder.io",
      },
    });
  });

  it("retries direct client requests with configured fallback bearer tokens", async () => {
    const bearerTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST")
          return new Response("not found", { status: 404 });
        bearerTokens.push(
          String(new Headers(init.headers).get("authorization") ?? "").replace(
            /^Bearer\s+/i,
            "",
          ),
        );
        const body = JSON.parse(String(init.body));
        if (bearerTokens.length === 1) {
          return new Response("Invalid or expired A2A token", { status: 401 });
        }
        return completedResponse(body, "retried with fallback bearer");
      }),
    );

    const client = new A2AClient("https://agent.test", "shared-token", {
      fallbackApiKeys: ["org-token"],
    });
    await expect(
      client.send({
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      }),
    ).resolves.toMatchObject({
      status: {
        message: {
          parts: [{ text: "retried with fallback bearer", type: "text" }],
        },
      },
    });

    expect(bearerTokens).toEqual(["shared-token", "org-token"]);
  });

  it("blocks private/internal A2A targets before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new A2AClient("http://127.0.0.1:4444");

    await expect(client.getAgentCard()).rejects.toThrow(/SSRF blocked/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function completedResponse(body: any, text: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        id: "task-ok",
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [{ type: "text", text }],
          },
        },
        history: [],
        artifacts: [],
      },
    }),
    { status: 200 },
  );
}

function workingResponse(
  body: any,
  taskId: string,
  status: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        id: taskId,
        status: {
          state: "working",
          timestamp: new Date().toISOString(),
          ...status,
        },
        history: [],
        artifacts: [],
      },
    }),
    { status: 200 },
  );
}
