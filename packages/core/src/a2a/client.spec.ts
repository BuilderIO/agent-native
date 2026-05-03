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
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("uses the A2A endpoint advertised by the agent card", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init) {
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
      if (!init) return new Response("not found", { status: 404 });
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
        if (!init) return new Response("not found", { status: 404 });
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
