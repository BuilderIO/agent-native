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
  REALTIME_VOICE_CAPABILITY_HEADER,
  REALTIME_VOICE_MAX_SDP_BYTES,
  REALTIME_VOICE_MAX_SESSION_BYTES,
  REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES,
  REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
  REALTIME_VOICE_MAX_TOOLS,
  REALTIME_VOICE_SESSION_PATH,
  REALTIME_VOICE_TOOL_PATH,
  REALTIME_VOICE_TOOL_GRANT_TTL_MS,
  realtimeVoiceSafetyIdentifier,
  resolveRealtimeVoiceLanguagePreference,
  resolveRealtimeVoicePreference,
  resolveRealtimeVoiceReasoningEffort,
  resolveRealtimeVoiceTranscriptionLanguage,
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

function discoveryActions(count = REALTIME_VOICE_MAX_TOOLS + 8) {
  const actions: Record<string, ActionEntry> = {};
  for (let index = 0; index < count; index++) {
    actions[`filler_${index}`] = {
      tool: {
        name: `filler_${index}`,
        description: `Filler ${index}`,
        parameters: { type: "object", properties: {} },
      },
      run: vi.fn(),
    };
  }
  actions["tool-search"] = {
    tool: {
      name: "tool-search",
      description: "Discover tools",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
    readOnly: true,
    run: vi.fn(),
  };
  actions["rare-action"] = {
    tool: {
      name: "rare-action",
      description: "Perform a rare action",
      parameters: {
        type: "object",
        properties: { target: { type: "string" } },
      },
    },
    run: vi.fn(),
  };
  actions["other-rare-action"] = {
    tool: {
      name: "other-rare-action",
      description: "Perform another rare action",
      parameters: { type: "object", properties: {} },
    },
    run: vi.fn(),
  };
  return actions;
}

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
  actions?: Record<string, ActionEntry>;
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
  const { actions = ACTIONS, ...routeOptions } = options ?? {};
  const executeTool = routeOptions.executeTool ?? vi.fn();
  const routes = mountRealtimeVoiceRoutes(nitroApp, actions, {
    executeTool: executeTool as any,
    ...routeOptions,
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

async function issueToolCapability(
  handlers: Map<string, Handler>,
  headers: Record<string, string> = {},
): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=capability\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    ),
  );
  const event = sessionEvent(undefined, headers);
  await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event);
  const capability = event.responseHeaders[REALTIME_VOICE_CAPABILITY_HEADER];
  expect(capability).toMatch(/^[a-f0-9]{32}$/);
  return capability;
}

function withToolCapability(
  capability: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return { ...headers, [REALTIME_VOICE_CAPABILITY_HEADER]: capability };
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

describe("resolveRealtimeVoiceTranscriptionLanguage", () => {
  it("uses the preferred ISO-639-1 language from Accept-Language", () => {
    expect(resolveRealtimeVoiceTranscriptionLanguage("en-US,en;q=0.9")).toBe(
      "en",
    );
    expect(
      resolveRealtimeVoiceTranscriptionLanguage("en;q=0.5, zh-CN;q=0.9"),
    ).toBe("zh");
  });

  it("defaults safely to English", () => {
    expect(resolveRealtimeVoiceTranscriptionLanguage(undefined)).toBe("en");
    expect(resolveRealtimeVoiceTranscriptionLanguage("*;q=1, invalid")).toBe(
      "en",
    );
  });
});

describe("realtime voice inline preferences", () => {
  it("accepts validated language, intelligence, and built-in voice values", () => {
    expect(resolveRealtimeVoiceLanguagePreference("en", "zh-CN")).toBe("en");
    expect(resolveRealtimeVoiceLanguagePreference("invalid", "fr-FR")).toBe(
      "fr",
    );
    expect(resolveRealtimeVoiceReasoningEffort("instant")).toBe("minimal");
    expect(resolveRealtimeVoiceReasoningEffort("balanced")).toBe("low");
    expect(resolveRealtimeVoiceReasoningEffort("deep")).toBe("medium");
    expect(resolveRealtimeVoiceReasoningEffort("__proto__")).toBe("low");
    expect(resolveRealtimeVoicePreference("cedar", "marin")).toBe("cedar");
    expect(resolveRealtimeVoicePreference("custom-id", "marin")).toBe("marin");
  });
});

describe("realtime voice session route", () => {
  it("keeps navigation tools visible when a template registry exceeds the tool cap", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "builder-private-example",
      publicKey: "builder-public-example",
      userId: null,
    });
    actionsToEngineTools.mockReturnValue([
      ...Array.from({ length: REALTIME_VOICE_MAX_TOOLS + 8 }, (_, index) => ({
        name: `template_tool_${index}`,
        description: `Template tool ${index}`,
        inputSchema: { type: "object", properties: {} },
      })),
      {
        name: "view-screen",
        description: "View the current screen",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "set-search-params",
        description: "Update URL filters",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "navigate",
        description: "Navigate the app",
        inputSchema: ACTIONS.navigate.tool.parameters,
      },
      {
        name: "set-url-path",
        description: "Navigate by URL",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "tool-search",
        description: "Discover tools",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("v=0\r\ns=builder\r\n", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = mount();
    await handlers.get(REALTIME_VOICE_SESSION_PATH)!(sessionEvent());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(
      request.session.tools
        .slice(0, 5)
        .map((tool: { name: string }) => tool.name),
    ).toEqual([
      "navigate",
      "set-url-path",
      "set-search-params",
      "view-screen",
      "tool-search",
    ]);
    expect(request.session.tools).toHaveLength(REALTIME_VOICE_MAX_TOOLS);
  });

  it("caps tools to the Builder realtime gateway contract", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "builder-private-example",
      publicKey: "builder-public-example",
      userId: null,
    });
    actionsToEngineTools.mockReturnValue(
      Array.from({ length: REALTIME_VOICE_MAX_TOOLS + 8 }, (_, index) => ({
        name: `tool_${index}`,
        description: `Tool ${index}`,
        inputSchema: { type: "object", properties: {} },
      })),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = mount();
    await handlers.get(REALTIME_VOICE_SESSION_PATH)!(sessionEvent());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(request.session.tools).toHaveLength(REALTIME_VOICE_MAX_TOOLS);
    expect(request.session.tools[0].name).toBe("tool_0");
    expect(request.session.tools.at(-1).name).toBe("tool_31");
  });

  it("packs tools within the Builder realtime session byte budget", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "builder-private-example",
      publicKey: "builder-public-example",
      userId: null,
    });
    actionsToEngineTools.mockReturnValue(
      Array.from({ length: 4 }, (_, index) => ({
        name: `large_tool_${index}`,
        description: `Large tool ${index}`,
        inputSchema: {
          type: "object",
          description: "x".repeat(25_000),
        },
      })),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = mount();
    await handlers.get(REALTIME_VOICE_SESSION_PATH)!(sessionEvent());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = String(init.body);
    const request = JSON.parse(requestBody);
    expect(request.session.tools).toHaveLength(2);
    expect(
      Buffer.byteLength(JSON.stringify(request.session), "utf8"),
    ).toBeLessThanOrEqual(REALTIME_VOICE_MAX_SESSION_BYTES);
  });

  it("rejects tool schemas over the UTF-8 byte limit", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "builder-private-example",
      publicKey: "builder-public-example",
      userId: null,
    });
    actionsToEngineTools.mockReturnValue([
      {
        name: "oversized_multibyte_tool",
        description: "Too large in UTF-8",
        inputSchema: {
          type: "object",
          description: "🧪".repeat(
            Math.ceil(REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES / 4),
          ),
        },
      },
      {
        name: "small_tool",
        description: "Fits",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = mount();
    await handlers.get(REALTIME_VOICE_SESSION_PATH)!(sessionEvent());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(
      request.session.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["small_tool"]);
  });

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
    const event = sessionEvent(undefined, {
      "accept-language": "zh-CN, en;q=0.9",
      "x-agent-native-realtime-language": "en",
      "x-agent-native-realtime-intelligence": "deep",
      "x-agent-native-realtime-voice": "cedar",
    });

    const result = await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event);

    expect(result).toBe("v=0\r\ns=openai\r\n");
    expect(event.statusCode).toBe(201);
    expect(event.responseHeaders).toMatchObject({
      "Content-Type": "application/sdp",
      "Cache-Control": "no-store",
      [REALTIME_VOICE_CAPABILITY_HEADER]:
        expect.stringMatching(/^[a-f0-9]{32}$/),
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
      parallel_tool_calls: false,
      reasoning: { effort: "medium" },
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "en",
          },
          turn_detection: {
            type: "semantic_vad",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: "cedar" },
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
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
          },
        },
        tool_choice: "auto",
      },
    });
  });

  it("accepts same-origin SDP through a host-rewriting reverse proxy", async () => {
    resolveBuilderCredentials.mockResolvedValue({
      privateKey: "bpk-private-test",
      publicKey: "space-public-test",
      userId: "builder-user-test",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("v=0\r\ns=builder\r\n", {
        status: 201,
        headers: { "content-type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { handlers } = mount();
    const event = sessionEvent(undefined, {
      host: "127.0.0.1:8088",
      origin: "http://127.0.0.1:8080",
      "x-forwarded-host": "127.0.0.1:8080",
      "x-forwarded-proto": "http",
      "sec-fetch-site": "same-origin",
    });

    expect(await handlers.get(REALTIME_VOICE_SESSION_PATH)!(event)).toBe(
      "v=0\r\ns=builder\r\n",
    );
    expect(event.statusCode).toBe(201);
    expect(fetchMock).toHaveBeenCalledOnce();
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
  it("requires the opaque capability minted by a successful SDP session", async () => {
    const executeTool = vi.fn();
    const { handlers } = mount({ executeTool });
    const event = toolEvent({
      name: "navigate",
      args: {},
      callId: "call_without_capability",
    });

    expect(await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event)).toEqual({
      error: "Invalid or expired realtime voice capability",
    });
    expect(event.statusCode).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects a body browser tab that differs from the capability-bound tab", async () => {
    const executeTool = vi.fn();
    const { handlers } = mount({ executeTool });
    const capability = await issueToolCapability(handlers, {
      "x-agent-native-browser-tab": "tab-a",
    });
    const event = toolEvent(
      {
        name: "navigate",
        args: {},
        callId: "call_wrong_tab",
        browserTabId: "tab-b",
      },
      withToolCapability(capability, {
        "x-agent-native-browser-tab": "tab-a",
      }),
    );

    expect(await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event)).toEqual({
      error: "Realtime voice browser tab mismatch",
    });
    expect(event.statusCode).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("expands only registry-backed tools from a successful specific tool search", async () => {
    const actions = discoveryActions();
    const executeTool = vi.fn(async (request: { name: string }) => {
      if (request.name === "tool-search") {
        return {
          status: "completed" as const,
          output: JSON.stringify({
            query: "rare capability",
            results: [{ name: "rare-action" }, { name: "invented-action" }],
          }),
        };
      }
      return { status: "completed" as const, output: "rare action complete" };
    });
    const { handlers } = mount({ actions, executeTool });
    const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;
    const capability = await issueToolCapability(handlers);

    const beforeSearch = toolEvent(
      {
        name: "rare-action",
        args: { target: "dashboard" },
        callId: "call_before",
        sessionId: "voice-session-1",
      },
      withToolCapability(capability),
    );
    expect(await handler(beforeSearch)).toEqual({
      error: "Unknown realtime voice tool",
    });
    expect(beforeSearch.statusCode).toBe(404);

    const search = toolEvent(
      {
        name: "tool-search",
        args: { query: "rare capability", includeSchemas: true },
        callId: "call_search",
        sessionId: "voice-session-1",
      },
      withToolCapability(capability),
    );
    expect(await handler(search)).toEqual({
      callId: "call_search",
      status: "completed",
      output: JSON.stringify({
        query: "rare capability",
        results: [{ name: "rare-action" }, { name: "invented-action" }],
      }),
      expandedTools: [
        {
          type: "function",
          name: "rare-action",
          description: "Perform a rare action",
          parameters: actions["rare-action"]!.tool.parameters,
        },
      ],
    });

    const discovered = toolEvent(
      {
        name: "rare-action",
        args: { target: "dashboard" },
        callId: "call_after",
        sessionId: "voice-session-1",
      },
      withToolCapability(capability),
    );
    expect(await handler(discovered)).toEqual({
      callId: "call_after",
      status: "completed",
      output: "rare action complete",
    });
    expect(executeTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "rare-action" }),
    );

    const otherSession = toolEvent(
      {
        name: "rare-action",
        args: {},
        callId: "call_other",
        sessionId: "voice-session-2",
      },
      withToolCapability(capability),
    );
    expect(await handler(otherSession)).toEqual({
      callId: "call_other",
      status: "completed",
      output: "rare action complete",
    });
  });

  it("does not expand menu searches and expires session grants", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    try {
      const actions = discoveryActions();
      const executeTool = vi.fn(async (request: { name: string }) => ({
        status: "completed" as const,
        output:
          request.name === "tool-search"
            ? JSON.stringify({ results: [{ name: "rare-action" }] })
            : "done",
      }));
      const { handlers } = mount({ actions, executeTool });
      const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;
      const capability = await issueToolCapability(handlers);

      const menu = toolEvent(
        {
          name: "tool-search",
          args: {},
          callId: "call_menu",
          sessionId: "voice-session-menu",
        },
        withToolCapability(capability),
      );
      const menuResult = (await handler(menu)) as Record<string, unknown>;
      expect(menuResult).not.toHaveProperty("expandedTools");

      const search = toolEvent(
        {
          name: "tool-search",
          args: { query: "rare" },
          callId: "call_search_ttl",
          sessionId: "voice-session-ttl",
        },
        withToolCapability(capability),
      );
      const searchResult = (await handler(search)) as Record<string, unknown>;
      expect(searchResult).toHaveProperty("expandedTools");

      vi.advanceTimersByTime(REALTIME_VOICE_TOOL_GRANT_TTL_MS + 1);
      const expired = toolEvent(
        {
          name: "rare-action",
          args: {},
          callId: "call_expired",
          sessionId: "voice-session-ttl",
        },
        withToolCapability(capability),
      );
      expect(await handler(expired)).toEqual({
        error: "Invalid or expired realtime voice capability",
      });
      expect(expired.statusCode).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an actively used capability alive with sliding expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    try {
      const actions = discoveryActions();
      const executeTool = vi.fn(async (request: { name: string }) => ({
        status: "completed" as const,
        output:
          request.name === "tool-search"
            ? JSON.stringify({ results: [{ name: "rare-action" }] })
            : "done",
      }));
      const { handlers } = mount({ actions, executeTool });
      const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;
      const capability = await issueToolCapability(handlers);
      const headers = withToolCapability(capability);

      await handler(
        toolEvent(
          {
            name: "tool-search",
            args: { query: "rare" },
            callId: "call_search_sliding",
          },
          headers,
        ),
      );

      vi.advanceTimersByTime(REALTIME_VOICE_TOOL_GRANT_TTL_MS - 1);
      expect(
        await handler(
          toolEvent(
            { name: "rare-action", args: {}, callId: "call_refresh" },
            headers,
          ),
        ),
      ).toEqual({
        callId: "call_refresh",
        status: "completed",
        output: "done",
      });

      vi.advanceTimersByTime(REALTIME_VOICE_TOOL_GRANT_TTL_MS - 1);
      expect(
        await handler(
          toolEvent(
            { name: "rare-action", args: {}, callId: "call_still_live" },
            headers,
          ),
        ),
      ).toEqual({
        callId: "call_still_live",
        status: "completed",
        output: "done",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains bounded discoveries across sequential specific searches", async () => {
    const actions = discoveryActions();
    const executeTool = vi.fn(async (request: { name: string; args: any }) => {
      if (request.name === "tool-search") {
        const name =
          request.args.query === "first" ? "rare-action" : "other-rare-action";
        return {
          status: "completed" as const,
          output: JSON.stringify({ results: [{ name }] }),
        };
      }
      return { status: "completed" as const, output: "done" };
    });
    const { handlers } = mount({ actions, executeTool });
    const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;
    const capability = await issueToolCapability(handlers);

    for (const [query, callId] of [
      ["first", "search_first"],
      ["second", "search_second"],
    ] as const) {
      await handler(
        toolEvent(
          {
            name: "tool-search",
            args: { query },
            callId,
          },
          withToolCapability(capability),
        ),
      );
    }

    const invokeFirst = toolEvent(
      { name: "rare-action", args: {}, callId: "invoke_first" },
      withToolCapability(capability),
    );
    expect(await handler(invokeFirst)).toEqual({
      callId: "invoke_first",
      status: "completed",
      output: "done",
    });
  });

  it("bounds expanded tool schemas to the realtime manifest limits", async () => {
    const actions = discoveryActions(REALTIME_VOICE_MAX_TOOLS + 50);
    const deferredNames = Array.from(
      { length: REALTIME_VOICE_MAX_TOOLS + 8 },
      (_, index) => `filler_${index + REALTIME_VOICE_MAX_TOOLS - 1}`,
    );
    const executeTool = vi.fn().mockResolvedValue({
      status: "completed",
      output: JSON.stringify({
        results: deferredNames.map((name) => ({ name })),
      }),
    });
    const { handlers } = mount({ actions, executeTool });
    const capability = await issueToolCapability(handlers);
    const result = (await handlers.get(REALTIME_VOICE_TOOL_PATH)!(
      toolEvent(
        {
          name: "tool-search",
          args: { query: "filler" },
          callId: "call_bounded",
          sessionId: "voice-session-bounded",
        },
        withToolCapability(capability),
      ),
    )) as { expandedTools: Array<{ name: string }> };

    expect(result.expandedTools).toHaveLength(REALTIME_VOICE_MAX_TOOLS);
    expect(
      Buffer.byteLength(JSON.stringify(result.expandedTools), "utf8"),
    ).toBeLessThanOrEqual(REALTIME_VOICE_MAX_SESSION_BYTES);
  });

  it("validates request shape and only allows advertised registry tools", async () => {
    const executeTool = vi.fn();
    const { handlers } = mount({ executeTool });
    const handler = handlers.get(REALTIME_VOICE_TOOL_PATH)!;
    const capability = await issueToolCapability(handlers);

    for (const body of [
      { name: "navigate", args: [], callId: "call_1" },
      { name: "navigate", args: {}, callId: "bad call id" },
      { name: "navigate", callId: "call_1" },
    ]) {
      const event = toolEvent(body, withToolCapability(capability));
      expect(await handler(event)).toEqual({
        error: "Invalid realtime tool request",
      });
      expect(event.statusCode).toBe(400);
    }

    const hidden = toolEvent(
      { name: "hidden", args: {}, callId: "call_2" },
      withToolCapability(capability),
    );
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
    const capability = await issueToolCapability(handlers);
    const event = toolEvent(
      {
        name: "navigate",
        args: { view: "settings" },
        callId: "call_123",
      },
      withToolCapability(capability),
    );

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

  it("routes navigation execution through the active browser tab", async () => {
    const contexts: unknown[] = [];
    runWithRequestContext.mockImplementation(
      async (context: unknown, callback: () => Promise<unknown>) => {
        contexts.push(context);
        return callback();
      },
    );
    const executeTool = vi.fn().mockResolvedValue({
      status: "completed",
      output: "Navigating",
    });
    const { handlers } = mount({ executeTool });
    const capability = await issueToolCapability(handlers, {
      "x-agent-native-browser-tab": "analytics-tab-1",
    });
    const event = toolEvent(
      {
        name: "navigate",
        args: { dashboardId: "dashboard-1" },
        callId: "call_tab",
      },
      withToolCapability(capability, {
        "x-agent-native-browser-tab": "analytics-tab-1",
      }),
    );

    await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event);

    expect(contexts).toContainEqual(
      expect.objectContaining({
        run: expect.objectContaining({
          browserTabId: "analytics-tab-1",
          threadId: "realtime:call_tab",
        }),
      }),
    );
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "navigate",
        browserTabId: "analytics-tab-1",
      }),
    );
  });

  it("preserves approval metadata and truncates sanitized output", async () => {
    const executeTool = vi.fn().mockResolvedValue({
      status: "approval_required",
      output: `Bearer private-value ${"x".repeat(REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS)}`,
      approvalKey: "approval:navigate:123",
    });
    const { handlers } = mount({ executeTool });
    const capability = await issueToolCapability(handlers);
    const event = toolEvent(
      {
        name: "navigate",
        args: {},
        callId: "call_approval",
      },
      withToolCapability(capability),
    );

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
    const capability = await issueToolCapability(handlers);
    const event = toolEvent(
      {
        name: "navigate",
        args: {},
        callId: "call_failure",
      },
      withToolCapability(capability),
    );

    const result = await handlers.get(REALTIME_VOICE_TOOL_PATH)!(event);
    expect(event.statusCode).toBe(500);
    expect(result).toEqual({
      callId: "call_failure",
      status: "failed",
      output: "action failed with api_key=[REDACTED]",
    });
  });
});
