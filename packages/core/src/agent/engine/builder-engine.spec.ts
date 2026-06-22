import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BUILDER_CAPABILITIES,
  BUILDER_DEFAULT_MODEL,
  createBuilderEngine,
} from "./builder-engine.js";
import { DEFAULT_BUILDER_MAX_OUTPUT_TOKENS } from "./output-tokens.js";
import * as captureErrorModule from "../../server/capture-error.js";
import type { EngineStreamOptions } from "./types.js";

const credentialState = vi.hoisted(() => ({
  builderPrivateKey: "bpk-test" as string | null,
  builderPublicKey: "space-test" as string | null,
  builderUserId: "builder-user-123" as string | null,
  builderOrgName: null as string | null,
  recordBuilderCredentialAuthFailure: vi.fn(async () => {}),
}));

// Mock the credential provider so tests do not hit the DB (app_secrets table).
vi.mock("../../server/credential-provider.js", async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import("../../server/credential-provider.js");
  return {
    ...original,
    resolveBuilderCredential: vi.fn(async (key: string) => {
      if (key === "BUILDER_PRIVATE_KEY")
        return credentialState.builderPrivateKey;
      if (key === "BUILDER_PUBLIC_KEY") return credentialState.builderPublicKey;
      if (key === "BUILDER_USER_ID") return credentialState.builderUserId;
      if (key === "BUILDER_ORG_NAME") return credentialState.builderOrgName;
      return null;
    }),
    resolveBuilderCredentials: vi.fn(async () => ({
      privateKey: credentialState.builderPrivateKey,
      publicKey: credentialState.builderPublicKey,
      userId: credentialState.builderUserId,
      orgName: credentialState.builderOrgName,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
    })),
    resolveBuilderAuthHeader: vi.fn(async () => {
      const key = credentialState.builderPrivateKey;
      return key ? `Bearer ${key}` : null;
    }),
    recordBuilderCredentialAuthFailure:
      credentialState.recordBuilderCredentialAuthFailure,
    getBuilderGatewayBaseUrl: original.getBuilderGatewayBaseUrl,
  };
});

async function collectEvents(iterable: AsyncIterable<any>) {
  const events: any[] = [];
  for await (const e of iterable) events.push(e);
  return events;
}

function jsonlResponse(events: unknown[]): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const encoded = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/jsonl" },
  });
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_OPTS: EngineStreamOptions = {
  model: "claude-sonnet-4-6",
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  tools: [],
  abortSignal: new AbortController().signal,
};

describe("createBuilderEngine", () => {
  beforeEach(() => {
    credentialState.builderPrivateKey = "bpk-test";
    credentialState.builderPublicKey = "space-test";
    credentialState.builderUserId = "builder-user-123";
    credentialState.builderOrgName = null;
    credentialState.recordBuilderCredentialAuthFailure.mockClear();
    vi.stubEnv("BUILDER_PRIVATE_KEY", "bpk-test");
    vi.stubEnv("BUILDER_PUBLIC_KEY", "space-test");
    vi.stubEnv("BUILDER_USER_ID", "builder-user-123");
    vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://test.example/gateway/v1");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes metadata matching the gateway catalog", () => {
    const engine = createBuilderEngine();
    expect(engine.name).toBe("builder");
    expect(engine.defaultModel).toBe(BUILDER_DEFAULT_MODEL);
    expect(engine.defaultModel).toBe("claude-sonnet-4-6");
    expect(engine.capabilities).toMatchObject(BUILDER_CAPABILITIES);
    expect(engine.supportedModels).toContain("claude-sonnet-4-6");
    expect(engine.supportedModels).toContain("auto");
    expect(engine.supportedModels).toContain("claude-opus-4-7");
    expect(engine.supportedModels).toContain("gpt-5-5");
    expect(engine.supportedModels).toContain("gpt-5-4");
    expect(engine.supportedModels).not.toContain("z-ai-glm-4-5");
  });

  it("emits a missing-credentials stop-error when BUILDER_PRIVATE_KEY is unset", async () => {
    credentialState.builderPrivateKey = null;
    vi.unstubAllEnvs();
    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));
    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(stop?.error).toContain("Agent settings > LLM");
    expect(stop?.error).not.toContain("BUILDER_PRIVATE_KEY");
  });

  it("short-circuits with missing-credentials when resolved Builder credentials are incomplete", async () => {
    const { resolveBuilderCredentials } =
      await import("../../server/credential-provider.js");
    vi.mocked(resolveBuilderCredentials).mockResolvedValueOnce({
      privateKey: null,
      publicKey: "space-test",
      userId: null,
      orgName: null,
      orgKind: null,
      subscription: null,
      subscriptionLevel: null,
      subscriptionName: null,
      isEnterprise: null,
      isFreeAccount: null,
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("short-circuits with missing-credentials when BUILDER_PUBLIC_KEY is unset", async () => {
    credentialState.builderPublicKey = null;

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to the gateway /messages endpoint with bearer auth and owner headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonlResponse([
        { type: "text-delta", text: "Hi!" },
        { type: "usage", inputTokens: 10, outputTokens: 2 },
        { type: "stop", reason: "end_turn", requestId: "req_1" },
      ]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    await collectEvents(engine.stream(BASE_OPTS));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://test.example/gateway/v1/messages?apiKey=space-test",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer bpk-test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["x-builder-api-key"]).toBe("space-test");
    expect(init.headers["x-builder-user-id"]).toBe("builder-user-123");
    expect(init.headers["x-client-name"]).toBe("@agent-native/core");
    expect(String(init.headers["x-client-version"])).toMatch(/\d+\.\d+\.\d+/);

    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(DEFAULT_BUILDER_MAX_OUTPUT_TOKENS);
    // With prompt caching enabled the system prompt is wrapped in an array
    // with a cache_control block on the last element.
    expect(body.system).toEqual([
      {
        type: "text",
        text: "You are helpful.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    // Message should have a cache_control block on its last content element.
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Hi", cache_control: { type: "ephemeral" } },
        ],
      },
    ]);
  });

  it("honors an explicit max output token override", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonlResponse([
          { type: "stop", reason: "end_turn", requestId: "req_1" },
        ]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    await collectEvents(engine.stream({ ...BASE_OPTS, maxOutputTokens: 1024 }));

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(1024);
  });

  it("streams text-delta events and emits assistant-content + stop(end_turn)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          { type: "text-delta", text: "Hello, " },
          { type: "text-delta", text: "world!" },
          {
            type: "usage",
            inputTokens: 5,
            outputTokens: 3,
            cacheInputTokens: 2,
            cacheCreatedTokens: 1,
          },
          { type: "stop", reason: "end_turn", requestId: "req_1" },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const textDeltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.text)
      .join("");
    expect(textDeltas).toBe("Hello, world!");

    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({
      inputTokens: 5,
      outputTokens: 3,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });

    const assistantContent = events.find((e) => e.type === "assistant-content");
    expect(assistantContent?.parts).toEqual([
      { type: "text", text: "Hello, world!" },
    ]);

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("end_turn");
  });

  it("assembles interleaved text and tool-call into assistant-content in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          { type: "text-delta", text: "Let me look." },
          {
            type: "tool-call",
            id: "toolu_01",
            name: "list_events",
            input: { from: "2026-04-22" },
          },
          { type: "stop", reason: "tool_use", requestId: "req_1" },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const toolCall = events.find((e) => e.type === "tool-call");
    expect(toolCall).toMatchObject({
      id: "toolu_01",
      name: "list_events",
      input: { from: "2026-04-22" },
    });

    const assistantContent = events.find((e) => e.type === "assistant-content");
    expect(assistantContent?.parts).toEqual([
      { type: "text", text: "Let me look." },
      {
        type: "tool-call",
        id: "toolu_01",
        name: "list_events",
        input: { from: "2026-04-22" },
      },
    ]);

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("tool_use");
  });

  it("maps tool-call-delta events to tool input progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "tool-call-delta",
            id: "toolu_01",
            name: "x",
            argsTextDelta: "{",
          },
          {
            type: "tool-call-delta",
            id: "toolu_01",
            name: "x",
            argsTextDelta: "}",
          },
          { type: "tool-call", id: "toolu_01", name: "x", input: {} },
          { type: "stop", reason: "tool_use", requestId: "req_1" },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    expect(events.filter((e) => e.type === "tool-input-delta")).toEqual([
      {
        type: "tool-input-delta",
        id: "toolu_01",
        name: "x",
        text: "{",
      },
      {
        type: "tool-input-delta",
        id: "toolu_01",
        name: "x",
        text: "}",
      },
    ]);
    expect(events.find((e) => e.type === "tool-call")).toBeDefined();
  });

  it("maps gateway heartbeat frames to gateway-heartbeat engine events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "heartbeat",
            requestId: "req_1",
            timestamp: 1_700_000_000_000,
          },
          { type: "text-delta", text: "Hi" },
          { type: "usage", inputTokens: 10, outputTokens: 2 },
          { type: "stop", reason: "end_turn", requestId: "req_1" },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    expect(events.filter((e) => e.type === "gateway-heartbeat")).toEqual([
      { type: "gateway-heartbeat" },
    ]);
    expect(events.some((e) => e.type === "text-delta" && e.text === "Hi")).toBe(
      true,
    );
  });

  it("maps 402 credits-limit-monthly to stop-error with errorCode + upgradeUrl", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(402, {
          code: "credits-limit-monthly",
          message:
            "You've reached the monthly AI credits limit for your current plan.",
          usageInfo: {
            plan: "free",
            limitExceeded: "monthly",
            isEnterprise: false,
          },
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("credits-limit-monthly");
    expect(stop?.upgradeUrl).toContain("builder.io");
    expect(stop?.error).toContain("monthly AI credits");
  });

  it("routes upgradeUrl to the org-agnostic billing page (BUILDER_ORG_NAME is a display name, not a URL slug)", async () => {
    credentialState.builderOrgName = "Acme Corp";
    vi.stubEnv("BUILDER_ORG_NAME", "Acme Corp");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(402, {
          code: "credits-limit-daily",
          message: "Daily limit reached.",
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.upgradeUrl).toBe("https://builder.io/account/billing");
  });

  it("maps 401 unauthorized to Builder auth stop-error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(401, {
          code: "unauthorized",
          message: "Invalid key",
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_auth_error");
    expect(stop?.error).toContain("Builder authentication failed");
    expect(
      credentialState.recordBuilderCredentialAuthFailure,
    ).toHaveBeenCalledWith({
      status: 401,
      code: "unauthorized",
      message: "Invalid key",
    });
  });

  it("maps 403 invalid token to Builder auth stop-error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(403, {
          message: "Invalid token",
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_auth_error");
    expect(stop?.error).toContain("Builder authentication failed");
    expect(
      credentialState.recordBuilderCredentialAuthFailure,
    ).toHaveBeenCalledWith({
      status: 403,
      code: "http_403",
      message: "Invalid token",
    });
  });

  it("maps inactive personal access token errors to Builder auth stop-error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Invalid or inactive personal access token", {
          status: 403,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_auth_error");
    expect(stop?.error).toContain("Builder authentication failed");
    expect(
      credentialState.recordBuilderCredentialAuthFailure,
    ).toHaveBeenCalledWith({
      status: 403,
      code: "http_403",
      message: "Invalid or inactive personal access token",
    });
  });

  it("maps streamed personal access token errors to Builder auth stop-error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "stop",
            reason: "error",
            error: "Invalid or inactive personal access token",
            requestId: "req_1",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_auth_error");
    expect(stop?.error).toBe("Invalid or inactive personal access token");
    expect(
      credentialState.recordBuilderCredentialAuthFailure,
    ).toHaveBeenCalledWith({
      code: "builder_auth_error",
      message: "Invalid or inactive personal access token",
    });
  });

  it("surfaces a non-JSON 4xx body (e.g. proxy HTML) in the error message", async () => {
    // A reverse proxy returning a bare HTML 502/504 should not swallow the
    // body silently. Before the fix, `.json()` would throw and the
    // `.text()` fallback would fail because the body stream was already
    // consumed — leaving only the generic "Builder gateway returned N" message.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("http_502");
    expect(stop?.error).toContain("Bad Gateway");
  });

  it("treats bare 402 (no structured code) as a credits-limit with upgrade CTA", async () => {
    credentialState.builderOrgName = "acme";
    vi.stubEnv("BUILDER_ORG_NAME", "acme");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Payment Required", {
          status: 402,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.upgradeUrl).toBe("https://builder.io/account/billing");
  });

  it("maps 429 concurrency to a retryable error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(429, {
          code: "too_many_concurrent_requests",
          message: "Too many concurrent gateway requests.",
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("too_many_concurrent_requests");
    // Must contain "too many requests" so production-agent's isRetryableError triggers.
    expect(stop?.error?.toLowerCase()).toContain("too many requests");
  });

  it("maps daily gateway caps to a non-retryable error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonErrorResponse(429, {
          code: "rate_limit_exceeded",
          message:
            "Daily gateway request cap reached (cap: 5000). Please try again tomorrow.",
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("rate_limit_exceeded");
    expect(stop?.error).toBe(
      "Daily gateway request cap reached (cap: 5000). Please try again tomorrow.",
    );
  });

  it("aborts hung gateway requests before the host function timeout", async () => {
    vi.stubEnv("AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS", "1");
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_timeout");
    expect(stop?.error).toContain("Builder gateway timed out");
  });

  it("marks socket hangups as retryable gateway network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("socket hang up")),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_network_error");
    expect(stop?.error).toContain("Builder gateway network error");
    expect(stop?.error).toContain("socket hang up");
  });

  it("keeps the hard timeout active while reading the gateway stream", async () => {
    vi.stubEnv("AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS", "1");
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(init.signal?.reason ?? new Error("aborted"));
          });
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/jsonl" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_timeout");
    expect(stop?.error).toContain("Builder gateway timed out");
  });

  it("uses the localhost gateway timeout cap when AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS is unset", async () => {
    vi.stubEnv(
      "BUILDER_GATEWAY_BASE_URL",
      "http://localhost:8080/agent-native/gateway/v1",
    );
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const eventsPromise = collectEvents(engine.stream(BASE_OPTS));
    await vi.advanceTimersByTimeAsync(45_000);

    let settledEarly = false;
    void eventsPromise.then(() => {
      settledEarly = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settledEarly).toBe(false);

    await vi.advanceTimersByTimeAsync(135_000);
    const events = await eventsPromise;

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_timeout");
    expect(stop?.error).toContain("180s");
  });

  it("caps configured gateway timeouts with room before the 60s serverless function limit", async () => {
    vi.stubEnv("AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS", "60000");
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const eventsPromise = collectEvents(engine.stream(BASE_OPTS));
    await vi.advanceTimersByTimeAsync(45_000);
    const events = await eventsPromise;

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_timeout");
    expect(stop?.error).toContain("45s");
  });

  it("maps mid-stream rate_limited into a retryable error stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          { type: "text-delta", text: "partial..." },
          {
            type: "stop",
            reason: "rate_limited",
            requestId: "req_1",
            error: "retries exhausted",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("rate_limited");
    expect(stop?.error?.toLowerCase()).toContain("rate_limit");
  });

  it("maps invalid_request stops into a non-retryable error stop preserving the gateway message and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "stop",
            reason: "invalid_request",
            requestId: "req_bad_history",
            error:
              "messages.87: `tool_use` ids were found without `tool_result` blocks immediately after: history_tc_80.",
            errorCode: "tool_message_shape_invalid",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("tool_message_shape_invalid");
    expect(stop?.error).toContain("history_tc_80");
    // No retry-trigger keywords (see production-agent's isRetryableError).
    expect(stop?.error?.toLowerCase()).not.toMatch(
      /rate_limit|overloaded|503|504|gateway error|socket hang up|connection reset|too many requests|timeout/,
    );
  });

  it("marks no-detail gateway stop errors as retryable gateway errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "stop",
            reason: "error",
            requestId: "req_no_detail",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_error");
    expect(stop?.error).toContain("Gateway error (no detail");
  });

  it("captures no-detail gateway stop errors to Sentry with model + requestId tags", async () => {
    const captureSpy = vi
      .spyOn(captureErrorModule, "captureError")
      .mockReturnValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "stop",
            reason: "error",
            requestId: "req_no_detail",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    await collectEvents(engine.stream(BASE_OPTS));

    expect(captureSpy).toHaveBeenCalledTimes(1);
    const [capturedErr, capturedCtx] = captureSpy.mock.calls[0];
    expect((capturedErr as Error).name).toBe("BuilderGatewayNoDetailError");
    expect((capturedErr as Error).message).toContain("req_no_detail");
    expect(capturedCtx?.tags?.errorCode).toBe("builder_gateway_error");
    expect(capturedCtx?.tags?.model).toBe(BASE_OPTS.model);
    expect(capturedCtx?.tags?.gatewayRequestId).toBe("req_no_detail");
    expect(capturedCtx?.tags?.source).toBe("builder-engine");
    expect(capturedCtx?.extra?.gatewayOrigin).toBe("https://test.example");
    expect(capturedCtx?.contexts?.builderGateway?.requestId).toBe(
      "req_no_detail",
    );
  });

  it("does not capture to Sentry when the gateway provides an explicit error detail", async () => {
    const captureSpy = vi
      .spyOn(captureErrorModule, "captureError")
      .mockReturnValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonlResponse([
          {
            type: "stop",
            reason: "error",
            requestId: "req_with_detail",
            error: "upstream provider rejected the model",
          },
        ]),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.error).toContain("upstream provider rejected the model");
    // Errors with explicit detail are handled by the existing run-manager
    // capture; no need to also capture from builder-engine.
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("processes a final event without a trailing newline", async () => {
    // Some gateway proxies end the stream with a complete JSONL line that
    // lacks a terminating `\n`. The parser must flush that tail through the
    // same event-handling path, otherwise the stop event is silently
    // dropped and the consumer gets the synthetic
    // "stream ended without a stop event" error instead.
    const body =
      JSON.stringify({ type: "text-delta", text: "hi" }) +
      "\n" +
      JSON.stringify({ type: "stop", reason: "end_turn" }); // no trailing \n
    const encoded = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/jsonl" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("end_turn");
    expect(stop?.error).toBeUndefined();
    // Text-delta before the stop should still have been yielded.
    expect(events.some((e) => e.type === "text-delta" && e.text === "hi")).toBe(
      true,
    );
  });

  it("surfaces invalid JSONL lines as a stop-error", async () => {
    const body = "not a json\n";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/jsonl" },
        }),
      ),
    );

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.error).toContain("invalid JSONL");
  });

  it("forwards reasoning_effort mapped from Anthropic thinking.budgetTokens", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonlResponse([
          { type: "stop", reason: "end_turn", requestId: "req_1" },
        ]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    await collectEvents(
      engine.stream({
        ...BASE_OPTS,
        providerOptions: {
          anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
        },
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("high");
  });

  it("forwards explicit reasoning_effort without budget mapping", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonlResponse([
          { type: "stop", reason: "end_turn", requestId: "req_1" },
        ]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    await collectEvents(
      engine.stream({
        ...BASE_OPTS,
        model: "claude-opus-4-7",
        reasoningEffort: "xhigh",
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("xhigh");
  });
});
