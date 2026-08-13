import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  A2AClient,
  A2ATaskTerminalError,
  A2ATaskTimeoutError,
  callAction,
  callAgent,
  signA2AToken,
} from "./client.js";

// ssrfSafeFetch does a REAL node:dns lookup before calling fetch. Under fake
// timers that wall-clock work can take seconds on CI resolvers (agent.test is
// not a real host), so fake time races past request timeouts and deadlines
// before the stubbed fetch is ever reached. Keep the synchronous private-host
// check (the blocking test relies on it; IP literals need no DNS) and skip
// only the DNS phase — full SSRF behavior is covered by url-safety's own spec.
vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return {
    ...original,
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      if (original.isBlockedExtensionUrl(url)) {
        throw new Error(
          `SSRF blocked: refusing to fetch private/internal address (${url})`,
        );
      }
      return fetch(url, init);
    },
  };
});

describe("A2AClient", () => {
  const originalEnv = { ...process.env };
  const authenticatedJwt = [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(JSON.stringify({ sub: "user@example.test" })).toString(
      "base64url",
    ),
    "signature",
  ].join(".");

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

  it("retries an idempotent initial submission after a transient connection failure", async () => {
    const submissions: Array<Record<string, unknown>> = [];
    let postAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        postAttempts += 1;
        const body = JSON.parse(String(init.body));
        submissions.push(body.params);
        if (postAttempts === 1) throw new Error("socket hang up");
        return completedResponse(body, "recovered once");
      }),
    );

    await expect(
      callAgent("https://agent.test/_agent-native/a2a", "hello", {
        async: true,
        apiKey: authenticatedJwt,
      }),
    ).resolves.toBe("recovered once");
    expect(postAttempts).toBe(2);
    expect(submissions[0]?.idempotencyKey).toMatch(/^auto:/);
    expect(submissions[1]?.idempotencyKey).toBe(submissions[0]?.idempotencyKey);
  });

  it("does not retry synchronous message submissions even with an idempotency key", async () => {
    let postAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        postAttempts += 1;
        throw new Error("socket hang up");
      }),
    );

    await expect(
      callAgent("https://agent.test/_agent-native/a2a", "hello", {
        async: false,
        apiKey: authenticatedJwt,
        idempotencyKey: "sync-key",
      }),
    ).rejects.toThrow("socket hang up");
    expect(postAttempts).toBe(1);
  });

  it("does not retry ownerless async message submissions", async () => {
    let postAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        postAttempts += 1;
        throw new Error("socket hang up");
      }),
    );

    await expect(
      callAgent("https://agent.test/_agent-native/a2a", "hello", {
        async: true,
      }),
    ).rejects.toThrow("socket hang up");
    expect(postAttempts).toBe(1);
  });

  it("retries an idempotent submission after a transient 429", async () => {
    let postAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        postAttempts += 1;
        const body = JSON.parse(String(init.body));
        if (postAttempts === 1) {
          return new Response("busy", { status: 429 });
        }
        return completedResponse(body, "recovered after rate limit");
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        async: true,
        apiKey: authenticatedJwt,
      }),
    ).resolves.toBe("recovered after rate limit");
    expect(postAttempts).toBe(2);
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
        { timeoutMs: 30, pollIntervalMs: 1 },
      ),
    ).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-qa",
      lastState: "working",
      timeoutMs: 30,
    });

    await expect(
      client.sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 30, pollIntervalMs: 1 },
      ),
    ).rejects.toBeInstanceOf(A2ATaskTimeoutError);
  });

  it("includes initial submission in the end-to-end timeout budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        return new Promise<Response>((_resolve, reject) => {
          const rejectAborted = () =>
            reject(new DOMException("The operation was aborted", "AbortError"));
          if (init.signal?.aborted) {
            rejectAborted();
            return;
          }
          init.signal?.addEventListener("abort", rejectAborted, { once: true });
        });
      }),
    );

    const startedAt = Date.now();
    await expect(
      new A2AClient("https://agent.test").sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 30, pollIntervalMs: 1 },
      ),
    ).rejects.toThrow(/aborted|deadline/i);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("reserves a bounded deadline for submission when agent-card discovery hangs", async () => {
    let postAttempted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postAttempted = true;
          return completedResponse(
            JSON.parse(String(init.body)),
            "submitted after discovery timeout",
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          const rejectAborted = () =>
            reject(new DOMException("The operation was aborted", "AbortError"));
          if (init?.signal?.aborted) {
            rejectAborted();
            return;
          }
          init?.signal?.addEventListener("abort", rejectAborted, {
            once: true,
          });
        });
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        timeoutMs: 200,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe("submitted after discovery timeout");
    expect(postAttempted).toBe(true);
  });

  it("surfaces permanent task-status errors without waiting for the deadline", async () => {
    let taskReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-gone");
        }
        taskReads += 1;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32004, message: "Task not found" },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      new A2AClient("https://agent.test").sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 5_000, pollIntervalMs: 1 },
      ),
    ).rejects.toThrow(/Task not found/);
    expect(taskReads).toBe(1);
  });

  it("isolates progress callback errors from terminal task handling", async () => {
    let taskReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-callback");
        }
        taskReads += 1;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-callback",
              status: {
                state: "completed",
                message: {
                  role: "agent",
                  parts: [{ type: "text", text: "finished despite callback" }],
                },
              },
              artifacts: [],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        timeoutMs: 1_000,
        pollIntervalMs: 1,
        onUpdate: () => {
          throw new Error("presentation failed");
        },
      }),
    ).resolves.toBe("finished despite callback");
    expect(taskReads).toBe(1);
  });

  it("bounds a hung task-status request by the overall poll deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit): Promise<Response> => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-hung-poll");
        }

        return new Promise<Response>((_resolve, reject) => {
          const rejectAborted = () =>
            reject(new DOMException("The operation was aborted", "AbortError"));
          if (init.signal?.aborted) {
            rejectAborted();
            return;
          }
          init.signal?.addEventListener("abort", rejectAborted, {
            once: true,
          });
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new A2AClient("https://agent.test");
    const result = client.sendAndWait(
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { timeoutMs: 5_000, pollIntervalMs: 1_000 },
    );
    // Attach a handler before advancing timers so the intentional rejection is
    // never reported as unhandled while the fake clock is moving.
    void result.catch(() => undefined);

    const hasTaskRead = () =>
      fetchMock.mock.calls.some(
        ([, init]) =>
          init?.method === "POST" &&
          JSON.parse(String(init.body)).method === "tasks/get",
      );
    // waitFor advances fake time in coarse intervals. Stepping the clock 1ms at
    // a time performs 1,000 async flushes and can exceed Vitest's real 5s test
    // timeout when the full suite is under load.
    await vi.waitFor(() => expect(hasTaskRead()).toBe(true), {
      interval: 100,
      timeout: 5_000,
    });
    await vi.runAllTimersAsync();
    await expect(result).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-hung-poll",
      lastState: "working",
      timeoutMs: 5_000,
    });
    expect(hasTaskRead()).toBe(true);
    expect(
      fetchMock.mock.calls.find(
        ([, init]) =>
          init?.method === "POST" &&
          JSON.parse(String(init.body)).method === "tasks/get",
      )?.[1]?.signal,
    ).toBeInstanceOf(AbortSignal);
  }, 30_000);

  it("recovers after one task-status request exceeds the per-request timeout", async () => {
    vi.useFakeTimers();
    let taskReads = 0;
    let firstPollSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return workingResponse(body, "task-transient-hung-poll");
        }

        taskReads += 1;
        if (taskReads === 1) {
          firstPollSignal = init.signal ?? null;
          return new Promise<Response>((_resolve, reject) => {
            const rejectAborted = () =>
              reject(
                new DOMException("The operation was aborted", "AbortError"),
              );
            if (init.signal?.aborted) {
              rejectAborted();
              return;
            }
            init.signal?.addEventListener("abort", rejectAborted, {
              once: true,
            });
          });
        }
        return completedResponse(body, "recovered after transient poll hang");
      }),
    );

    const client = new A2AClient("https://agent.test");
    const result = client.sendAndWait(
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      { timeoutMs: 60_000, pollIntervalMs: 1_000 },
    );
    // Attach a handler before advancing timers so an unexpected rejection is
    // never reported as unhandled while the fake clock is moving.
    void result.catch(() => undefined);

    // Same coarse-interval pacing rationale as the hung-poll test above.
    await vi.waitFor(() => expect(taskReads).toBeGreaterThan(0), {
      interval: 100,
      timeout: 5_000,
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({
      status: {
        state: "completed",
        message: {
          parts: [
            { type: "text", text: "recovered after transient poll hang" },
          ],
        },
      },
    });
    expect(firstPollSignal?.aborted).toBe(true);
    expect(taskReads).toBe(2);
  }, 30_000);

  it("returns input-required without polling until timeout", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            id: "task-approval",
            status: {
              state: "input-required",
              message: {
                role: "agent",
                parts: [{ type: "text", text: "Approval required" }],
              },
            },
            history: [],
            artifacts: [],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new A2AClient("https://agent.test");
    await expect(
      client.sendAndWait({
        role: "user",
        parts: [{ type: "text", text: "send" }],
      }),
    ).resolves.toMatchObject({
      id: "task-approval",
      status: { state: "input-required" },
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it.each(["failed", "canceled", "input-required"] as const)(
    "preserves a %s task as a typed terminal error",
    async (state) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                id: `task-${state}`,
                status: {
                  state,
                  message: {
                    role: "agent",
                    parts: [{ type: "text", text: `${state} details` }],
                  },
                },
                history: [],
                artifacts: [],
              },
            }),
            { status: 200 },
          );
        }),
      );

      await expect(
        callAgent("https://agent.test", "hello"),
      ).rejects.toMatchObject({
        name: "A2ATaskTerminalError",
        taskId: `task-${state}`,
        state,
        responseText: `${state} details`,
      });
      await expect(
        callAgent("https://agent.test", "hello"),
      ).rejects.toBeInstanceOf(A2ATaskTerminalError);
    },
  );

  it("rejects completed tasks with neither text nor a verified artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-empty",
              status: { state: "completed" },
              history: [],
              artifacts: [],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).rejects.toMatchObject({
      name: "A2ATaskTerminalError",
      state: "completed",
      errorCode: "empty_agent_response",
    });
  });

  it("accepts a verified artifact as completion evidence when text is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-artifact",
              status: { state: "completed" },
              history: [],
              artifacts: [
                {
                  name: "customer-deck.pptx",
                  parts: [
                    {
                      type: "file",
                      file: {
                        name: "customer-deck.pptx",
                        uri: "https://slides.agent.test/deck/customer-deck",
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).resolves.toContain("customer-deck.pptx");
  });

  it("rejects a named artifact with no usable parts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-empty-artifact",
              status: { state: "completed" },
              artifacts: [{ name: "empty.pptx", parts: [] }],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).rejects.toMatchObject({ errorCode: "empty_agent_response" });
  });

  it("accepts an unnamed artifact with a usable data reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-data-artifact",
              status: { state: "completed" },
              artifacts: [
                {
                  parts: [
                    {
                      type: "data",
                      data: {
                        artifactId: "deck-123",
                        url: "https://slides.agent.test/deck/deck-123",
                      },
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).resolves.toContain("https://slides.agent.test/deck/deck-123");
  });

  it("rejects oversized completed text instead of treating a partial truncation as success", async () => {
    const sentinelTail = "https://analytics.agent.test/artifact/result";
    const oversized = "A".repeat(80_000) + sentinelTail;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return completedResponse(body, oversized);
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", { async: false }),
    ).rejects.toMatchObject({
      name: "A2ATaskTerminalError",
      state: "completed",
      errorCode: "a2a_response_too_large",
    });
  });

  it("continues an existing task without submitting duplicate work", async () => {
    const methods: string[] = [];
    let taskReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        methods.push(body.method);
        expect(body.method).toBe("tasks/get");
        taskReads += 1;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-existing",
              status:
                taskReads === 1
                  ? { state: "working" }
                  : {
                      state: "completed",
                      message: {
                        role: "agent",
                        parts: [{ type: "text", text: "finished once" }],
                      },
                    },
              history: [],
              artifacts: [],
            },
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      callAgent("https://agent.test", "", {
        taskId: "task-existing",
        pollIntervalMs: 1,
      }),
    ).resolves.toBe("finished once");
    expect(methods).toEqual(["tasks/get", "tasks/get"]);
    expect(methods).not.toContain("message/send");
  });

  it("sends exact approved actions as top-level authenticated request data", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.approvedActions).toEqual([
        { tool: "send-email", input: { to: "alice@example.test" } },
      ]);
      return completedResponse(body, "sent");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new A2AClient("https://agent.test");
    await client.send(
      { role: "user", parts: [{ type: "text", text: "send it" }] },
      {
        approvedActions: [
          { tool: "send-email", input: { to: "alice@example.test" } },
        ],
      },
    );
  });

  it("transports structured source context in A2A metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.metadata.sourceContext).toEqual({
        platform: "slack",
        integrationTaskId: "integration-task-1",
      });
      return completedResponse(body, "sent");
    });
    vi.stubGlobal("fetch", fetchMock);

    await callAgent("https://agent.test", "capture this", {
      async: false,
      sourceContext: {
        platform: "slack",
        integrationTaskId: "integration-task-1",
      },
    });
  });

  it("forwards additional metadata without letting it override caller identity", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params.metadata).toMatchObject({
        googleToken: "fake-google-token",
        userEmail: "verified@example.test",
      });
      return completedResponse(body, "sent");
    });
    vi.stubGlobal("fetch", fetchMock);

    await callAgent("https://agent.test", "capture this", {
      async: false,
      metadata: {
        googleToken: "fake-google-token",
        userEmail: "spoofed@example.test",
      },
      userEmail: "verified@example.test",
    });
  });

  it("sends bounded correlation metadata and idempotency at the protocol top level", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params).toMatchObject({
        contextId: "thread-qa",
        idempotencyKey: "v1:stable-key",
        metadata: {
          callerApp: "mail",
          callerThreadId: "thread-qa",
          parentRunId: "run-qa",
          parentTurnId: "turn-qa",
        },
      });
      expect(body.params.metadata.invocationId).toBeUndefined();
      return completedResponse(body, "correlated");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAgent("https://agent.test", "hello", {
        async: false,
        contextId: "thread-qa",
        idempotencyKey: "v1:stable-key",
        correlation: {
          callerApp: "mail",
          callerThreadId: "thread-qa",
          parentRunId: "run-qa",
          parentTurnId: "turn-qa",
          invocationId: "x".repeat(201),
        },
      }),
    ).resolves.toBe("correlated");
  });

  it("invokes an exposed read-only action without sending a message", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.method).toBe("actions/invoke");
      expect(body.params).toEqual({
        action: "gong-calls",
        input: { company: "Acme", days: 30 },
        metadata: {
          callerApp: "mail",
          invocationId: "invoke-qa",
          parentRunId: "run-qa",
          parentTurnId: "turn-qa",
        },
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "gong-calls",
            status: "completed",
            output: '{"total":2}',
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new A2AClient("https://analytics.test", "signed-token");
    await expect(
      client.invokeAction(
        "gong-calls",
        { company: "Acme", days: 30 },
        {
          metadata: {
            callerApp: "mail",
            invocationId: "invoke-qa",
            parentRunId: "run-qa",
            parentTurnId: "turn-qa",
          },
        },
      ),
    ).resolves.toEqual({
      action: "gong-calls",
      status: "completed",
      output: '{"total":2}',
    });
  });

  it("binds direct action identity tokens to the receiving app", async () => {
    process.env.A2A_SECRET = "shared-direct-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const authorization = new Headers(init.headers).get("authorization");
      const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
      expect(jose.decodeJwt(token).aud).toBe("https://analytics.test");
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "gong-calls",
            status: "completed",
            output: '{"total":2}',
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction(
        "https://analytics.test/",
        "gong-calls",
        { company: "Acme" },
        { userEmail: "alice@example.test" },
      ),
    ).resolves.toMatchObject({ status: "completed", output: '{"total":2}' });
  });

  it("preserves a receiver base path in direct action audiences", async () => {
    process.env.A2A_SECRET = "shared-direct-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const authorization = new Headers(init.headers).get("authorization");
      const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
      expect(jose.decodeJwt(token).aud).toBe(
        "https://workspace.example/slides",
      );
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "list-decks",
            status: "completed",
            output: "[]",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction(
        "https://workspace.example/slides",
        "list-decks",
        {},
        { userEmail: "alice@example.test" },
      ),
    ).resolves.toMatchObject({ status: "completed", output: "[]" });
  });

  it("binds direct action identity to a custom advertised A2A endpoint", async () => {
    process.env.A2A_SECRET = "shared-direct-secret";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://agent.example/workspace/rpc/a2a");
      const authorization = new Headers(init?.headers).get("authorization");
      const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
      expect(jose.decodeJwt(token).aud).toBe(
        "https://agent.example/workspace/rpc",
      );
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "list-records",
            status: "completed",
            output: "[]",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction(
        "https://agent.example/workspace/rpc/a2a",
        "list-records",
        {},
        { userEmail: "alice@example.test" },
      ),
    ).resolves.toMatchObject({ status: "completed", output: "[]" });
  });

  it("re-signs a direct action for a custom endpoint discovered from an app URL", async () => {
    process.env.A2A_SECRET = "shared-direct-secret";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";

      if (init?.method !== "POST") {
        expect(url).toBe(
          "https://agent.example/workspace/.well-known/agent-card.json",
        );
        expect(authorization).toBeNull();
        return new Response(
          JSON.stringify({
            name: "Custom Agent",
            description: "Uses a custom A2A endpoint",
            url: "https://agent.example/workspace/rpc/a2a",
            version: "1.0.0",
            protocolVersion: "0.3",
            capabilities: {},
            skills: [],
          }),
          { status: 200 },
        );
      }

      expect(url).toBe("https://agent.example/workspace/rpc/a2a");
      expect(jose.decodeJwt(token).aud).toBe(
        "https://agent.example/workspace/rpc",
      );
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "list-records",
            status: "completed",
            output: "[]",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction(
        "https://agent.example/workspace",
        "list-records",
        {},
        { userEmail: "alice@example.test" },
      ),
    ).resolves.toMatchObject({ status: "completed", output: "[]" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries direct action with the audience-bound token after receiver rejection", async () => {
    process.env.A2A_SECRET = "shared-direct-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
      const body = JSON.parse(String(init?.body));

      if (token === "static-key") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: {
              code: -32001,
              message:
                "A verified, audience-bound user identity is required for direct action invocation",
            },
          }),
          { status: 200 },
        );
      }

      expect(jose.decodeJwt(token).aud).toBe("https://analytics.test");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            action: "gong-calls",
            status: "completed",
            output: '{"total":2}',
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction(
        "https://analytics.test/",
        "gong-calls",
        { company: "Acme" },
        {
          apiKey: "static-key",
          userEmail: "alice@example.test",
          orgSecret: "shared-direct-secret",
        },
      ),
    ).resolves.toMatchObject({ status: "completed", output: '{"total":2}' });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2);
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
      timeoutMs: 200,
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

  it("reserves a separate submission budget before the bounded poll handoff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response("not found", { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 20);
            init.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
          return workingResponse(body, "task-slow-submission");
        }
        return workingResponse(body, "task-slow-submission");
      }),
    );

    await expect(
      callAgent("https://slides.agent.test", "make a deck", {
        timeoutMs: 5,
        submissionTimeoutMs: 50,
        pollIntervalMs: 1,
        returnRecoverableArtifactsOnTimeout: false,
      }),
    ).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-slow-submission",
      timeoutMs: 5,
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
      timeoutMs: 50,
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

  it("tries explicit bearer token fallbacks in order", async () => {
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
        if (bearerTokens.length < 3) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32001, message: "Invalid or expired A2A token" },
            }),
            { status: 401 },
          );
        }
        return completedResponse(body, "signed with explicit fallback");
      }),
    );

    await expect(
      callAgent("https://agent.test", "hello", {
        async: false,
        apiKey: "primary-test-key",
        apiKeyFallbacks: ["first-test-fallback", "second-test-fallback"],
      }),
    ).resolves.toBe("signed with explicit fallback");

    expect(bearerTokens).toEqual([
      "primary-test-key",
      "first-test-fallback",
      "second-test-fallback",
    ]);
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
