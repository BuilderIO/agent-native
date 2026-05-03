import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BUILDER_CAPABILITIES,
  BUILDER_DEFAULT_MODEL,
  createBuilderEngine,
} from "./builder-engine.js";
import type { EngineStreamOptions } from "./types.js";

const credentialState = vi.hoisted(() => ({
  builderPrivateKey: "bpk-test" as string | null,
  builderOrgName: null as string | null,
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
      if (key === "BUILDER_ORG_NAME") return credentialState.builderOrgName;
      return null;
    }),
    resolveBuilderAuthHeader: vi.fn(async () => {
      const key = credentialState.builderPrivateKey;
      return key ? `Bearer ${key}` : null;
    }),
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
    credentialState.builderOrgName = null;
    vi.stubEnv("BUILDER_PRIVATE_KEY", "bpk-test");
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
    expect(engine.capabilities).toMatchObject(BUILDER_CAPABILITIES);
    expect(engine.supportedModels).toContain("claude-sonnet-4-6");
    expect(engine.supportedModels).toContain("gpt-5-4");
    expect(engine.supportedModels).toContain("z-ai-glm-4-5");
  });

  it("emits a missing-credentials stop-error when BUILDER_PRIVATE_KEY is unset", async () => {
    credentialState.builderPrivateKey = null;
    vi.unstubAllEnvs();
    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));
    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(stop?.error).toContain("Connect an LLM provider or Builder");
    expect(stop?.error).not.toContain("BUILDER_PRIVATE_KEY");
  });

  it("short-circuits with missing-credentials when resolveBuilderAuthHeader returns null", async () => {
    const { resolveBuilderAuthHeader } =
      await import("../../server/credential-provider.js");
    vi.mocked(resolveBuilderAuthHeader).mockResolvedValueOnce(null);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const engine = createBuilderEngine();
    const events = await collectEvents(engine.stream(BASE_OPTS));

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("missing_credentials");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to the gateway /messages endpoint with bearer auth", async () => {
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
    expect(url).toBe("https://test.example/gateway/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer bpk-test");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("You are helpful.");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ]);
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

  it("drops tool-call-delta events (engine contract has no equivalent)", async () => {
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

    expect(events.find((e) => e.type === "tool-call-delta")).toBeUndefined();
    expect(events.find((e) => e.type === "tool-call")).toBeDefined();
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

  it("deep-links upgradeUrl to the org billing page when BUILDER_ORG_NAME is set", async () => {
    credentialState.builderOrgName = "acme-corp";
    vi.stubEnv("BUILDER_ORG_NAME", "acme-corp");
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
    expect(stop?.upgradeUrl).toBe(
      "https://builder.io/app/organizations/acme-corp/billing",
    );
  });

  it("maps 401 unauthorized to stop-error with errorCode unauthorized", async () => {
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
    expect(stop?.errorCode).toBe("unauthorized");
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
    expect(stop?.upgradeUrl).toContain("acme");
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

  it("caps configured gateway timeouts below the 60s serverless function limit", async () => {
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
    await vi.advanceTimersByTimeAsync(55_000);
    const events = await eventsPromise;

    const stop = events.find((e) => e.type === "stop");
    expect(stop?.reason).toBe("error");
    expect(stop?.errorCode).toBe("builder_gateway_timeout");
    expect(stop?.error).toContain("55s");
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
