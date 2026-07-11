import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
  getRequestHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
  getMethod: (event: any) => event.method ?? "GET",
  readRawBody: async (event: any) =>
    event.rawBody == null ? event.rawBody : new Uint8Array(event.rawBody),
  setResponseHeader: (event: any, name: string, value: string) => {
    (event.responseHeaders ??= {})[name] = value;
  },
  setResponseStatus: (event: any, status: number) => {
    event.statusCode = status;
  },
}));

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const resolveSecret = vi.hoisted(() => vi.fn());
const resolveBuilderCredentials = vi.hoisted(() => vi.fn());
const gatewayBaseUrl = vi.hoisted(() => ({
  value: "https://api.builder.io/agent-native/gateway/v1",
}));
vi.mock("./credential-provider.js", () => ({
  resolveSecret: (...args: unknown[]) => resolveSecret(...args),
  resolveBuilderCredentials: (...args: unknown[]) =>
    resolveBuilderCredentials(...args),
  getBuilderGatewayBaseUrl: () => gatewayBaseUrl.value,
}));

vi.mock("../agent/engine/builder-gateway-headers.js", () => ({
  getBuilderGatewayRequestHeaders: () => ({
    "x-client-name": "@agent-native/core",
    "x-client-version": "test",
  }),
}));

const runWithRequestContext = vi.hoisted(() => vi.fn());
vi.mock("./request-context.js", () => ({
  runWithRequestContext: (...args: unknown[]) => runWithRequestContext(...args),
}));

vi.mock("./framework-request-handler.js", () => ({
  getH3App: (nitroApp: any) => nitroApp.h3,
}));

const actionsToEngineTools = vi.hoisted(() => vi.fn());
vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: (...args: unknown[]) => actionsToEngineTools(...args),
}));

import type { ActionEntry } from "../agent/production-agent.js";
import {
  mountRealtimeVoiceRoutes,
  REALTIME_VOICE_MAX_SDP_BYTES,
  REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
  REALTIME_VOICE_SESSION_PATH,
  REALTIME_VOICE_TOOL_PATH,
  realtimeVoiceSafetyIdentifier,
} from "./realtime-voice.js";

type Handler = (event: ReturnType<typeof fakeEvent>) => Promise<unknown>;

const ACTIONS = {
  navigate: {
    tool: {
      name: "navigate",
      description: "Navigate the app",
      parameters: {
        type: "object",
        properties: { view: { type: "string" } },
      },
    },
    run: vi.fn(),
  },
  hidden: {
    tool: {
      name: "hidden",
      description: "Hidden action",
      parameters: { type: "object", properties: {} },
    },
    run: vi.fn(),
    agentTool: false,
  },
} satisfies Record<string, ActionEntry>;

function fakeEvent(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}) {
  return {
    method: options.method ?? "POST",
    headers: options.headers ?? {},
    rawBody:
      typeof options.body === "string"
        ? Buffer.from(options.body, "utf8")
        : options.body,
    responseHeaders: {} as Record<string, string>,
    statusCode: 200,
  } as any;
}

function mount(options?: {
  getInstructions?: (context: any) => string | Promise<string>;
  model?: string;
  voice?: string;
  resolveOrgId?: (event: any) => string | Promise<string>;
  executeTool?: (request: any) => unknown | Promise<unknown>;
}) {
  const handlers = new Map<string, Handler>();
  const nitroApp = {
    h3: {
      use(path: string, handler: Handler) {
        handlers.set(path, handler);
      },
    },
  };
  const executeTool = options?.executeTool ?? vi.fn();
  const routes = mountRealtimeVoiceRoutes(nitroApp, ACTIONS, {
    executeTool: executeTool as any,
    ...options,
  });
  return { handlers, routes, executeTool };
}

function sessionEvent(
  body = "v=0\r\ns=agent-native\r\n",
  headers: Record<string, string> = {},
) {
  return fakeEvent({
    body,
    headers: { "content-type": "application/sdp", ...headers },
  });
}

function toolEvent(body: unknown, headers: Record<string, string> = {}) {
  return fakeEvent({
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  gatewayBaseUrl.value = "https://api.builder.io/agent-native/gateway/v1";
  getSession.mockResolvedValue({
    email: "person@example.com",
    orgId: "org-session",
  });
  resolveSecret.mockResolvedValue("sk-test-example");
  resolveBuilderCredentials.mockResolvedValue({
    privateKey: null,
    publicKey: null,
    userId: null,
  });
  runWithRequestContext.mockImplementation(
    async (_context: unknown, callback: () => Promise<unknown>) => callback(),
  );
  actionsToEngineTools.mockImplementation(
    (actions: Record<string, ActionEntry>) =>
      Object.entries(actions)
        .filter(([, entry]) => entry.agentTool !== false)
        .map(([name, entry]) => ({
          name,
          description: entry.tool.description,
          inputSchema: entry.tool.parameters,
        })),
  );
});

describe("mountRealtimeVoiceRoutes", () => {
  it("mounts the two framework routes and requires the central executor", () => {
    const { handlers, routes } = mount();
    expect(routes).toEqual({
      sessionPath: REALTIME_VOICE_SESSION_PATH,
      toolPath: REALTIME_VOICE_TOOL_PATH,
    });
    expect([...handlers.keys()]).toEqual([
      REALTIME_VOICE_SESSION_PATH,
      REALTIME_VOICE_TOOL_PATH,
    ]);

    expect(() =>
      mountRealtimeVoiceRoutes({ h3: { use: vi.fn() } }, ACTIONS, {} as any),
    ).toThrow(/executeTool/);
  });

  it("rejects unauthenticated session and tool requests", async () => {
    getSession.mockResolvedValue(null);
    const { handlers, executeTool } = mount();

    const session = sessionEvent();
    expect(await handlers.get(REALTIME_VOICE_SESSION_PATH)!(session)).toEqual({
      error: "Authentication required",
    });
    expect(session.statusCode).toBe(401);

    const tool = toolEvent({ name: "navigate", args: {}, callId: "call_1" });
    expect(await handlers.get(REALTIME_VOICE_TOOL_PATH)!(tool)).toEqual({
      error: "Authentication required",
    });
    expect(tool.statusCode).toBe(401);
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects cross-site session and tool requests before privileged work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const executeTool = vi.fn();
    const { handlers } = mount({ executeTool });
    const crossSiteHeaders = {
      host: "app.example.com",
      origin: "https://evil.example.com",
    };

    const session = sessionEvent(undefined, crossSiteHeaders);
    expect(await handlers.get(REALTIME_VOICE_SESSION_PATH)!(session)).toEqual({
      error: "Cross-origin request rejected",
    });
    expect(session.statusCode).toBe(403);

    const tool = toolEvent(
      { name: "navigate", args: {}, callId: "call_1" },
      crossSiteHeaders,
    );
    expect(await handlers.get(REALTIME_VOICE_TOOL_PATH)!(tool)).toEqual({
      error: "Cross-origin request rejected",
    });
    expect(tool.statusCode).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(resolveBuilderCredentials).not.toHaveBeenCalled();
    expect(resolveSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });
});

describe("realtime voice session route", () => {
  it("caps raw SDP before reading it", async () => {
    const { handlers } = mount();
    const event = sessionEvent("ignored", {
      "content-length": String(REALTIME_VOICE_MAX_SDP_BYTES + 1),
    });
    const result = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event);
    expect(event.statusCode).toBe(413);
    expect(result).toMatchObject({
      error: expect.stringMatching(/too large/i),
    });
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it("caps chunked SDP using the actual UTF-8 body size", async () => {
    const { handlers } = mount();
    const event = sessionEvent("x".repeat(REALTIME_VOICE_MAX_SDP_BYTES + 1));
    const result = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event);
    expect(event.statusCode).toBe(413);
    expect(result).toMatchObject({
      error: expect.stringMatching(/too large/i),
    });
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it("resolves the scoped key and creates a unified WebRTC call with safe defaults", async () => {
    let activeContext: unknown;
    runWithRequestContext.mockImplementation(
      async (context: unknown, callback: () => Promise<unknown>) => {
        activeContext = context;
        return callback();
      },
    );
    resolveSecret.mockImplementation(async () => {
      expect(activeContext).toMatchObject({
        userEmail: "person@example.com",
        orgId: "org-custom",
      });
      return "sk-test-example";
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=openai\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const getInstructions = vi
      .fn()
      .mockResolvedValue("The current view is the calendar.");
    const { handlers } = mount({
      resolveOrgId: async () => "org-custom",
      getInstructions,
    });
    const event = sessionEvent();

    const result = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event);

    expect(result).toBe("v=0\r\ns=openai\r\n");
    expect(event.statusCode).toBe(201);
    expect(event.responseHeaders).toMatchObject({
      "Content-Type": "application/sdp",
      "Cache-Control": "no-store",
    });
    expect(resolveSecret).toHaveBeenCalledWith("OPENAI_API_KEY");
    expect(getInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: "person@example.com",
        orgId: "org-custom",
      }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test-example",
      "OpenAI-Safety-Identifier":
        await realtimeVoiceSafetyIdentifier("person@example.com"),
    });
    const safetyIdentifier = (init.headers as Record<string, string>)[
      "OpenAI-Safety-Identifier"
    ];
    expect(safetyIdentifier).toMatch(/^[a-f0-9]{64}$/);
    expect(safetyIdentifier).not.toContain("person@example.com");

    const form = init.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\ns=agent-native\r\n");
    expect(typeof form.get("session")).toBe("string");
    const realtimeSession = JSON.parse(form.get("session") as string);
    expect(realtimeSession).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: {
            type: "semantic_vad",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: "marin" },
      },
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          name: "navigate",
          description: "Navigate the app",
          parameters: ACTIONS.navigate.tool.parameters,
        },
      ],
    });
    expect(realtimeSession.instructions).toContain(
      "The current view is the calendar.",
    );
  });

  it("never returns the API key on missing/upstream failures", async () => {
    const { handlers } = mount();
    resolveSecret.mockResolvedValueOnce(null);
    const missingKeyEvent = sessionEvent();
    const missingKeyResult = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(
      missingKeyEvent,
    );
    expect(missingKeyEvent.statusCode).toBe(409);
    expect(missingKeyResult).toMatchObject({
      code: "realtime_voice_setup_required",
    });
    expect(JSON.stringify(missingKeyResult)).not.toContain("sk-test-example");

    resolveSecret.mockResolvedValueOnce("sk-test-example");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("upstream could echo sk-test-example", { status: 401 }),
        ),
    );
    const failedEvent = sessionEvent();
    const failedResult = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(
      failedEvent,
    );
    expect(failedEvent.statusCode).toBe(502);
    expect(JSON.stringify(failedResult)).not.toContain("sk-test-example");
    expect(failedResult).toMatchObject({
      error: expect.stringContaining("[REDACTED]"),
    });
  });

  it("uses Builder managed realtime automatically when connected", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "bpk-private-test",
      publicKey: "space-public-test",
      userId: "builder-user-test",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 200,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { handlers } = mount();
    const event = sessionEvent();

    expect(await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event)).toBe(
      "v=0\r\ns=builder\r\n",
    );
    expect(resolveSecret).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.builder.io/agent-native/gateway/v1/realtime/calls?apiKey=space-public-test",
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer bpk-private-test",
      "Content-Type": "application/json",
      "x-builder-api-key": "space-public-test",
      "x-builder-user-id": "builder-user-test",
      "x-client-name": "@agent-native/core",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      sdp: "v=0\r\ns=agent-native\r\n",
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        tool_choice: "auto",
      },
    });
  });

  it("honors a local Builder gateway base URL", async () => {
    gatewayBaseUrl.value = "http://127.0.0.1:8181/agent-native/gateway/v1";
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "bpk-private-test",
      publicKey: "space-public-test",
      userId: "builder-user-test",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 200,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { handlers } = mount();

    await handlers.get(REALTIME_VOICE_SESSION_PATH)!(sessionEvent());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8181/agent-native/gateway/v1/realtime/calls?apiKey=space-public-test",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("realtime voice tool route", () => {
  it("validates request shape and only allows advertised registry tools", async () => {
    const executeTool = vi.fn();
    const { handlers } = mount({ executeTool });
    const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;

    for (const body of [
      { name: "navigate", args: [], callId: "call_1" },
      { name: "navigate", args: {}, callId: "bad call id" },
      { name: "navigate", callId: "call_1" },
    ]) {
      const event = toolEvent(body);
      expect(await handler(event)).toEqual({
        error: "Invalid realtime tool request",
      });
      expect(event.statusCode).toBe(400);
    }

    const hidden = toolEvent({ name: "hidden", args: {}, callId: "call_2" });
    expect(await handler(hidden)).toEqual({
      error: "Unknown realtime voice tool",
    });
    expect(hidden.statusCode).toBe(404);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("delegates through the central executor with request scope", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      status: "completed",
      output: JSON.stringify({ ok: true, apiKey: "do-not-expose" }),
      approvalKey: "must-not-survive",
    });
    const { handlers } = mount({ executeTool });
    const event = toolEvent({
      name: "navigate",
      args: { view: "settings" },
      callId: "call_123",
    });

    const result = await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event);

    expect(runWithRequestContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: "person@example.com",
        orgId: "org-session",
      }),
      expect.any(Function),
    );
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        event,
        userEmail: "person@example.com",
        orgId: "org-session",
        name: "navigate",
        args: { view: "settings" },
        callId: "call_123",
      }),
    );
    expect(result).toEqual({
      callId: "call_123",
      status: "completed",
      output: '{"ok":true,"apiKey":[REDACTED]}',
    });
  });

  it("preserves approval metadata and truncates sanitized output", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      status: "approval_required",
      output: `Bearer private-value ${"x".repeat(REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS)}`,
      approvalKey: "approval:navigate:123",
    });
    const { handlers } = mount({ executeTool });
    const event = toolEvent({
      name: "navigate",
      args: {},
      callId: "call_approval",
    });

    const result = (await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event)) as {
      status: string;
      output: string;
      approvalKey: string;
    };

    expect(result.status).toBe("approval_required");
    expect(result.approvalKey).toBe("approval:navigate:123");
    expect(result.output).toContain("Bearer [REDACTED]");
    expect(result.output).not.toContain("private-value");
    expect(result.output).toContain("...[truncated]");
  });

  it("returns a sanitized failure when the central executor throws", async () => {
    const executeTool = vi
      .fn()
      .mockRejectedValue(new Error("action failed with api_key=private-value"));
    const { handlers } = mount({ executeTool });
    const event = toolEvent({
      name: "navigate",
      args: {},
      callId: "call_failure",
    });

    const result = await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event);
    expect(event.statusCode).toBe(500);
    expect(result).toEqual({
      callId: "call_failure",
      status: "failed",
      output: "action failed with api_key=[REDACTED]",
    });
  });
});
