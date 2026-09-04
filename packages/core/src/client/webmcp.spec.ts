// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initializeWebMCPPolyfill } = vi.hoisted(() => ({
  initializeWebMCPPolyfill: vi.fn(),
}));

vi.mock("@mcp-b/webmcp-polyfill", () => ({
  initializeWebMCPPolyfill,
}));

import type { AgentNativeClientAction } from "./host-bridge.js";
import {
  AgentNativeWebMcpUnsupportedError,
  createAgentNativeWebMcpClient,
  createAgentNativeWebMcpRegistration,
  createAgentNativeServerActionWebMcpRegistration,
  createAgentNativeWebMcpPageHelper,
  getAgentNativeWebMcpPageHelper,
  getAgentNativeWebMcpStatus,
  initializeAgentNativeWebMcp,
  installAgentNativeWebMcpPageHelper,
} from "./webmcp.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function documentWithModelContext(modelContext: Record<string, unknown>) {
  return { modelContext } as unknown as Document;
}

describe("WebMCP client", () => {
  it("initializes the page-local polyfill when native WebMCP is unavailable", () => {
    const originalModelContext = Object.getOwnPropertyDescriptor(
      document,
      "modelContext",
    );
    initializeWebMCPPolyfill.mockImplementation(() => {
      Object.defineProperty(document, "modelContext", {
        configurable: true,
        value: {
          registerTool: vi.fn(),
          getTools: vi.fn(),
          executeTool: vi.fn(),
        },
      });
    });

    try {
      expect(initializeAgentNativeWebMcp()).toBe(true);
      expect(initializeWebMCPPolyfill).toHaveBeenCalledOnce();
    } finally {
      if (originalModelContext) {
        Object.defineProperty(document, "modelContext", originalModelContext);
      } else {
        delete (document as Document & { modelContext?: unknown }).modelContext;
      }
      initializeWebMCPPolyfill.mockReset();
    }
  });

  it("distinguishes an unsupported document from an empty tool list", async () => {
    const client = createAgentNativeWebMcpClient({
      document: {} as Document,
    });

    expect(client.supported).toBe(false);
    await expect(client.listTools()).rejects.toBeInstanceOf(
      AgentNativeWebMcpUnsupportedError,
    );
  });

  it("discovers serializable tools and executes the registered tool", async () => {
    const registeredTool = {
      name: "get-order",
      title: "Get order",
      description: "Read an order",
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
      window,
      origin: "https://shop.example",
      annotations: { readOnlyHint: true },
    };
    const executeTool = vi.fn(async () => '{"status":"shipped"}');
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => [registeredTool]),
      executeTool,
    };
    const client = createAgentNativeWebMcpClient({
      document: documentWithModelContext(modelContext),
      fromOrigins: ["https://shop.example"],
    });

    const tools = await client.listTools();
    expect(tools).toEqual([
      {
        name: "get-order",
        title: "Get order",
        description: "Read an order",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
        },
        origin: "https://shop.example",
        annotations: { readOnlyHint: true },
      },
    ]);
    expect(tools[0]).not.toHaveProperty("window");

    await expect(client.executeTool(tools[0], { id: "order-1" })).resolves.toBe(
      '{"status":"shipped"}',
    );
    await expect(
      client.executeTool({ name: "get-order" }, { id: "order-2" }),
    ).resolves.toBe('{"status":"shipped"}');
    expect(modelContext.getTools).toHaveBeenCalledWith({
      fromOrigins: ["https://shop.example"],
    });
    expect(executeTool).toHaveBeenCalledWith(
      registeredTool,
      '{"id":"order-1"}',
      {},
    );
  });

  it("passes object input to the Codex page adapter", async () => {
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      inputSchema: { type: "object" },
      window,
      origin: "https://shop.example",
    };
    const executeTool = vi.fn(async () => ({ status: "shipped" }));
    const client = createAgentNativeWebMcpClient({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [registeredTool]),
        executeTool,
        codexExecuteTool: vi.fn(),
      }),
    });

    const [tool] = await client.listTools();
    await expect(client.executeTool(tool, { id: "order-1" })).resolves.toEqual({
      status: "shipped",
    });
    expect(executeTool).toHaveBeenCalledWith(
      registeredTool,
      { id: "order-1" },
      {},
    );
  });

  it("refreshes the live descriptor and preserves structured results", async () => {
    const staleTool = {
      name: "get-order",
      title: "Stale order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const freshTool = {
      ...staleTool,
      title: "Fresh order",
    };
    const getTools = vi
      .fn()
      .mockResolvedValueOnce([staleTool])
      .mockResolvedValueOnce([freshTool]);
    const executeTool = vi.fn(async (tool: { title?: string }) => ({
      title: tool.title,
    }));
    const client = createAgentNativeWebMcpClient({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool,
      }),
    });

    const [tool] = await client.listTools();
    await expect(client.executeTool(tool)).resolves.toEqual({
      title: "Fresh order",
    });
    expect(executeTool).toHaveBeenCalledWith(freshTool, "{}", {});
  });

  it("executes the approved descriptor after a concurrent listing", async () => {
    const firstTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const secondTool = {
      ...firstTool,
      title: "Get order",
    };
    const getTools = vi
      .fn()
      .mockResolvedValueOnce([firstTool])
      .mockResolvedValueOnce([secondTool]);
    const executeTool = vi.fn(
      async (tool: { title?: string }) => tool.title ?? "first",
    );
    const client = createAgentNativeWebMcpClient({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool,
      }),
    });

    const [approvedTool] = await client.listTools();
    await client.listTools();

    await expect(client.executeListedTool(approvedTool)).resolves.toBe("first");
    expect(executeTool).toHaveBeenCalledWith(firstTool, "{}", {});
  });

  it("rejects duplicate tool names from the same origin", async () => {
    const tool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const client = createAgentNativeWebMcpClient({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [tool, { ...tool }]),
        executeTool: vi.fn(async () => ""),
      }),
    });

    await expect(client.listTools()).rejects.toThrow(
      'WebMCP returned duplicate tool "get-order"',
    );
  });
});

describe("automatic server action WebMCP registration", () => {
  it("prefixes server action routes at a configured app mount", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/docs");
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: "get-order",
              description: "Read an order",
              inputSchema: { type: "object" },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "order-1" })));

    const registration = createAgentNativeServerActionWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      fetch: fetchMock,
    });
    await registration.start();
    const tool = modelContext.registerTool.mock.calls[0]?.[0];
    await expect(tool?.execute({})).resolves.toBe('{"id":"order-1"}');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/docs/_agent-native/webmcp/manifest",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/docs/_agent-native/webmcp/actions/get-order",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("derives tools from the authenticated manifest and invokes the shared route", async () => {
    const registrations: Array<{ tool: Record<string, any>; options: any }> =
      [];
    const modelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ tool, options });
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: "get-order",
              title: "Read order",
              description: "Read an order",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
              },
              readOnly: true,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "order-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "order-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "order-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const registration = createAgentNativeServerActionWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      fetch: fetchMock,
    });
    await registration.start();

    expect(registrations[0]?.tool).toMatchObject({
      name: "get-order",
      title: "Read order",
      description: "Read an order",
      annotations: { readOnlyHint: true },
    });
    await expect(
      registrations[0]?.tool.execute(
        { id: "order-1" },
        { signal: new AbortController().signal },
      ),
    ).resolves.toBe('{"id":"order-1"}');
    await expect(
      registrations[0]?.tool.execute({ id: "order-1" }),
    ).resolves.toBe('{"id":"order-1"}');
    await expect(
      registrations[0]?.tool.execute({ id: "order-1" }, {}),
    ).resolves.toBe('{"id":"order-1"}');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/_agent-native/webmcp/manifest",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/_agent-native/webmcp/actions/get-order",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: '{"id":"order-1"}',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("accepts framework-scale catalogs and long backend descriptions", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const manifest = Array.from({ length: 101 }, (_, index) => ({
      name: `action-${index}`,
      description: index === 0 ? "x".repeat(2_001) : `Action ${index}`,
      inputSchema: { type: "object" },
    }));
    const registration = createAgentNativeServerActionWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      fetch: vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    });

    await registration.start();

    expect(registration.registered).toBe(101);
    expect(modelContext.registerTool).toHaveBeenCalledTimes(101);
  });
});

describe("WebMCP registration readiness", () => {
  // The status lives on the page's window, so a registration from an earlier
  // test in this file would otherwise leak into these assertions.
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeWebMcpStatus;
  });

  function action(name: string): AgentNativeClientAction {
    return {
      name,
      description: `Do ${name}`,
      parameters: { type: "object", properties: {} },
      readOnly: true,
      run: async () => ({ ok: true }),
    } as unknown as AgentNativeClientAction;
  }

  it("reports a partial tool list as still registering, not as complete", async () => {
    // Registration is concurrent: every registerTool call starts before any of
    // them resolves, so gate each one manually and release them one at a time
    // to see `registered` rise without ever reporting a partial list as ready.
    const gates = new Map<string, () => void>();
    const modelContext = {
      registerTool: vi.fn(
        (tool: { name: string }) =>
          new Promise<void>((resolve) => {
            gates.set(tool.name, resolve);
          }),
      ),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };

    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: [action("one"), action("two"), action("three")],
    });

    expect(getAgentNativeWebMcpStatus()).toBeUndefined();
    const startPromise = registration.start();
    await vi.waitFor(() => expect(gates.size).toBe(3));
    expect(getAgentNativeWebMcpStatus()).toEqual({
      state: "registering",
      registered: 0,
      total: 3,
    });

    gates.get("one")?.();
    await vi.waitFor(() =>
      expect(getAgentNativeWebMcpStatus()).toEqual({
        state: "registering",
        registered: 1,
        total: 3,
      }),
    );

    gates.get("two")?.();
    await vi.waitFor(() =>
      expect(getAgentNativeWebMcpStatus()).toEqual({
        state: "registering",
        registered: 2,
        total: 3,
      }),
    );

    gates.get("three")?.();
    await startPromise;

    expect(getAgentNativeWebMcpStatus()).toEqual({
      state: "ready",
      registered: 3,
      total: 3,
    });

    registration.stop();
    expect(getAgentNativeWebMcpStatus()).toBeUndefined();
  });

  it("does not let one registration's stop() erase another's status", async () => {
    // The status key is per-document. An unconditional delete on stop() would
    // erase a second, still-live registration and make its finished tool list
    // look like one that never started.
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const doc = documentWithModelContext(modelContext);

    const first = createAgentNativeWebMcpRegistration({
      document: doc,
      actions: [action("one")],
    });
    await first.start();

    const second = createAgentNativeWebMcpRegistration({
      document: doc,
      actions: [action("two"), action("three")],
    });
    await second.start();

    // The status is aggregated per document, so stopping one registration
    // must leave the other registration's readiness visible.
    first.stop();
    expect(getAgentNativeWebMcpStatus()).toEqual({
      state: "ready",
      registered: 2,
      total: 2,
    });

    second.stop();
    expect(getAgentNativeWebMcpStatus()).toBeUndefined();
  });

  it("marks a failed registration instead of leaving it stuck at registering", async () => {
    const modelContext = {
      registerTool: vi.fn(async (tool: { name: string }) => {
        if (tool.name === "two") throw new Error("registerTool exploded");
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };

    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: [action("one"), action("two")],
    });

    await expect(registration.start()).rejects.toThrow("registerTool exploded");
    expect(getAgentNativeWebMcpStatus()).toEqual({
      state: "failed",
      registered: 1,
      total: 2,
      error: "registerTool exploded",
    });

    registration.stop();
  });

  it("shares one in-flight start with concurrent callers", async () => {
    let resolveActions!: (actions: AgentNativeClientAction[]) => void;
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: () =>
        new Promise<AgentNativeClientAction[]>((resolve) => {
          resolveActions = resolve;
        }),
    });

    const first = registration.start();
    const second = registration.start();
    expect(second).toBe(first);
    resolveActions([action("one")]);
    await Promise.all([first, second]);
    expect(registration.registered).toBe(1);
    expect(getAgentNativeWebMcpStatus()).toEqual({
      state: "ready",
      registered: 1,
      total: 1,
    });

    registration.stop();
  });
});

describe("WebMCP registration", () => {
  it("maps explicit client actions and unregisters them on stop", async () => {
    const registrations: Array<{
      tool: Record<string, any>;
      options: Record<string, any>;
    }> = [];
    const modelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ tool, options });
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const run = vi.fn(async (args, runtime) => ({
      id: args.id,
      route: runtime.context.route?.name,
    }));
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: [
        {
          name: "select-order",
          description: "Select an order",
          parameters: {
            type: "object",
            properties: { id: { type: "string" } },
          },
          readOnly: true,
          run,
        },
      ],
      getContext: () => ({ route: { name: "orders" } }),
      session: { id: "tab-1" },
      exposedTo: ["https://agent.example"],
    });

    await registration.start();
    expect(registration.supported).toBe(true);
    expect(registration.registered).toBe(1);
    expect(registrations[0].tool).toMatchObject({
      name: "select-order",
      title: "Select order",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    });
    expect(registrations[0].tool).not.toHaveProperty("run");
    expect(registrations[0].options.exposedTo).toEqual([
      "https://agent.example",
    ]);

    await expect(
      registrations[0].tool.execute(
        { id: "order-1" },
        { signal: new AbortController().signal },
      ),
    ).resolves.toBe('{"id":"order-1","route":"orders"}');
    expect(run).toHaveBeenCalledWith(
      { id: "order-1" },
      expect.objectContaining({
        context: { route: { name: "orders" } },
        session: expect.objectContaining({ id: "tab-1" }),
      }),
    );

    registration.stop();
    expect(registration.registered).toBe(0);
    expect(registrations[0].options.signal.aborted).toBe(true);
  });

  it("requires an approval handler before exposing sensitive actions", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: [
        {
          name: "delete-order",
          description: "Delete an order",
          destructive: true,
          run: async () => ({ ok: true }),
        },
      ],
    });

    await expect(registration.start()).rejects.toThrow(
      'WebMCP action "delete-order" requires an approval handler',
    );
    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });

  it("does not register actions resolved after stop", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    let resolveActions!: (actions: AgentNativeClientAction[]) => void;
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: () =>
        new Promise<AgentNativeClientAction[]>((resolve) => {
          resolveActions = resolve;
        }),
    });

    const startPromise = registration.start();
    registration.stop();
    resolveActions([
      {
        name: "select-order",
        description: "Select an order",
        run: async () => ({ ok: true }),
      },
    ]);

    await expect(startPromise).resolves.toBeUndefined();
    expect(modelContext.registerTool).not.toHaveBeenCalled();
  });
});

describe("WebMCP page helper", () => {
  // The helper publishes onto the page's window, so clear both keys between
  // tests the way the readiness describe block above does for status alone.
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeWebMcpStatus;
    delete (window as unknown as Record<string, unknown>).__agentNativeWebMcp;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeWebMcpStatus;
    delete (window as unknown as Record<string, unknown>).__agentNativeWebMcp;
    vi.useRealTimers();
  });

  function readyStatus(registered: number, total = registered) {
    (window as unknown as Record<string, unknown>).__agentNativeWebMcpStatus = {
      state: "ready",
      registered,
      total,
    };
  }

  it("executes a live tool on a native context and parses a JSON-string result", async () => {
    readyStatus(1);
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const executeTool = vi.fn(async () => '{"status":"shipped"}');
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [registeredTool]),
        executeTool,
      }),
    });

    const outcome = await helper.call("get-order", { id: "order-1" });
    expect(outcome).toEqual({
      id: "webmcp-call-1",
      state: "done",
      ok: true,
      tool: "get-order",
      attempts: 1,
      result: { status: "shipped" },
    });
    expect(executeTool).toHaveBeenCalledWith(
      registeredTool,
      '{"id":"order-1"}',
      {},
    );
  });

  it("passes args directly on a Codex page adapter and exposes a JSON-string input schema as an object", async () => {
    readyStatus(1);
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
      window,
      origin: "https://shop.example",
    };
    const executeTool = vi.fn(async () => ({ status: "shipped" }));
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [registeredTool]),
        executeTool,
        codexExecuteTool: vi.fn(),
      }),
    });

    const outcome = await helper.call("get-order", { id: "order-1" });
    expect(outcome).toMatchObject({
      state: "done",
      ok: true,
      attempts: 1,
      result: { status: "shipped" },
    });
    expect(executeTool).toHaveBeenCalledWith(
      registeredTool,
      { id: "order-1" },
      {},
    );

    const [summary] = await helper.tools();
    expect(summary.required).toEqual(["id"]);
    const described = await helper.describe("get-order");
    expect(described?.inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  it("returns compact tool summaries and filters by string or RegExp", async () => {
    readyStatus(2);
    const longDescription = "x".repeat(250);
    const tools = [
      {
        name: "get-order",
        title: "Get Order",
        description: longDescription,
        inputSchema: { type: "object", properties: {}, required: ["id"] },
        window,
        origin: "https://shop.example",
        annotations: { readOnlyHint: true },
      },
      {
        name: "delete-order",
        description: "Remove an order forever",
        window,
        origin: "https://shop.example",
      },
    ];
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => tools),
        executeTool: vi.fn(async () => ""),
      }),
    });

    const all = await helper.tools();
    expect(all[0]).toEqual({
      name: "get-order",
      title: "Get Order",
      description: `${"x".repeat(239)}…`,
      required: ["id"],
      readOnly: true,
    });
    expect(all[1]).toEqual({
      name: "delete-order",
      description: "Remove an order forever",
      required: [],
      readOnly: false,
    });

    await expect(helper.tools("GET ORDER")).resolves.toEqual([
      expect.objectContaining({ name: "get-order" }),
    ]);
    await expect(helper.tools(/forever/)).resolves.toEqual([
      expect.objectContaining({ name: "delete-order" }),
    ]);
  });

  it("retries only on a stale descriptor and stops on other errors", async () => {
    readyStatus(1);
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const getTools = vi.fn(async () => [registeredTool]);
    const executeTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("RegisteredTool must be an object"))
      .mockRejectedValueOnce(new Error("RegisteredTool must be an object"))
      .mockResolvedValueOnce("shipped");
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool,
      }),
    });

    const outcome = await helper.call("get-order");
    expect(outcome).toMatchObject({
      ok: true,
      attempts: 3,
      result: "shipped",
    });
    expect(getTools).toHaveBeenCalledTimes(3);

    executeTool.mockRejectedValueOnce(new Error("boom"));
    const failure = await helper.call("get-order");
    expect(failure).toMatchObject({
      ok: false,
      code: "execution-failed",
      error: "boom",
      attempts: 1,
    });
  });

  it("reports not-registered when a tool is missing after registration settles", async () => {
    readyStatus(1);
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [
          {
            name: "get-order",
            description: "Read an order",
            window,
            origin: "https://shop.example",
          },
        ]),
        executeTool: vi.fn(async () => ""),
      }),
    });

    const outcome = await helper.call("nope");
    expect(outcome).toMatchObject({
      state: "done",
      ok: false,
      code: "not-registered",
      attempts: 1,
    });
    expect((outcome as { error?: string }).error).toMatch(/1 listed/);
  });

  it("reports registering when the ready() bound elapses mid-registration", async () => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>).__agentNativeWebMcpStatus = {
      state: "registering",
      registered: 0,
      total: 1,
    };
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => []),
        executeTool: vi.fn(async () => ""),
      }),
    });

    const outcomePromise = helper.call("nope", {}, { waitMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const outcome = await outcomePromise;

    expect(outcome).toMatchObject({ ok: false, code: "registering" });
  });

  it("returns a pending outcome for waitMs: 0 and resolves later via result()", async () => {
    readyStatus(1);
    let resolveExecute!: (value: string) => void;
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const executeTool = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [registeredTool]),
        executeTool,
      }),
    });

    const outcome = await helper.call("get-order", {}, { waitMs: 0 });
    expect(outcome).toMatchObject({ state: "pending", tool: "get-order" });
    const id = (outcome as { id: string }).id;

    expect(helper.result(id)).toMatchObject({ state: "pending" });
    expect(helper.result("unknown-id")).toEqual({
      id: "unknown-id",
      state: "unknown",
    });

    // call() only bounds the outer wait; run() keeps executing in the
    // background and reaches executeTool() a few microtask ticks later.
    await vi.waitFor(() => expect(executeTool).toHaveBeenCalled());
    resolveExecute('{"status":"shipped"}');
    await vi.waitFor(() => {
      expect(helper.result(id).state).toBe("done");
    });
    expect(helper.result(id)).toMatchObject({
      ok: true,
      result: { status: "shipped" },
    });
  });

  it("resolves ready() as soon as a real registration settles", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const modelContext = {
      registerTool: vi.fn(async () => {
        await gate;
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const doc = documentWithModelContext(modelContext);
    const registration = createAgentNativeWebMcpRegistration({
      document: doc,
      actions: [
        {
          name: "one",
          description: "Do one",
          parameters: { type: "object", properties: {} },
          readOnly: true,
          run: async () => ({ ok: true }),
        } as unknown as AgentNativeClientAction,
      ],
    });

    const startPromise = registration.start();
    const helper = createAgentNativeWebMcpPageHelper({ document: doc });
    const readyPromise = helper.ready();

    releaseGate();
    await startPromise;

    await expect(readyPromise).resolves.toEqual({
      state: "ready",
      registered: 1,
      total: 1,
    });

    registration.stop();
  });

  it("installs the page helper once and reads it back via getAgentNativeWebMcpPageHelper", () => {
    const first = installAgentNativeWebMcpPageHelper();
    const second = installAgentNativeWebMcpPageHelper();

    expect(second).toBe(first);
    expect(getAgentNativeWebMcpPageHelper()).toBe(first);
  });

  it("installs the page helper before a registration publishes its first status", async () => {
    expect(getAgentNativeWebMcpPageHelper()).toBeUndefined();
    const modelContext = {
      registerTool: vi.fn(async () => {
        expect(getAgentNativeWebMcpPageHelper()).toBeDefined();
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: [
        {
          name: "one",
          description: "Do one",
          parameters: { type: "object", properties: {} },
          readOnly: true,
          run: async () => ({ ok: true }),
        } as unknown as AgentNativeClientAction,
      ],
    });

    await registration.start();
    expect(getAgentNativeWebMcpPageHelper()).toBeDefined();
    registration.stop();
  });

  it("dispatches agentNative:refresh-data after a non-readOnly action but not a readOnly one", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: "update-order",
              description: "Update an order",
              inputSchema: { type: "object" },
            },
            {
              name: "get-order",
              description: "Read an order",
              inputSchema: { type: "object" },
              readOnly: true,
            },
          ]),
          { status: 200 },
        ),
      )
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true })),
      );

    const registration = createAgentNativeServerActionWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      fetch: fetchMock,
    });
    await registration.start();

    const events: Event[] = [];
    const onRefresh = (event: Event) => events.push(event);
    window.addEventListener("agentNative:refresh-data", onRefresh);
    try {
      const [writeTool, readTool] = modelContext.registerTool.mock.calls.map(
        (call) => call[0],
      );
      await writeTool.execute({});
      expect(events).toHaveLength(1);

      await readTool.execute({});
      expect(events).toHaveLength(1);
    } finally {
      window.removeEventListener("agentNative:refresh-data", onRefresh);
    }
  });
  it("reports execution-failed instead of hanging pending when getTools() rejects", async () => {
    readyStatus(1);
    const getTools = vi.fn(async () => {
      throw new Error("registry unavailable");
    });
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool: vi.fn(async () => ""),
      }),
    });

    const outcome = await helper.call("get-order");
    expect(outcome).toEqual({
      id: "webmcp-call-1",
      state: "done",
      ok: false,
      tool: "get-order",
      attempts: 1,
      code: "execution-failed",
      error: "registry unavailable",
      status: { state: "ready", registered: 1, total: 1 },
    });
    expect(helper.result("webmcp-call-1")).toEqual(outcome);
  });

  it("settles a pending ready() when the last registration stops instead of waiting for the bound", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const modelContext = {
      registerTool: vi.fn(async () => {
        await gate;
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const doc = documentWithModelContext(modelContext);
    const registration = createAgentNativeWebMcpRegistration({
      document: doc,
      actions: [
        {
          name: "one",
          description: "Do one",
          parameters: { type: "object", properties: {} },
          readOnly: true,
          run: async () => ({ ok: true }),
        } as unknown as AgentNativeClientAction,
      ],
    });

    const startPromise = registration.start();
    const helper = createAgentNativeWebMcpPageHelper({ document: doc });
    const readyPromise = helper.ready();

    registration.stop();

    await expect(readyPromise).resolves.toEqual({
      state: "failed",
      registered: 0,
      total: 0,
      error: "WebMCP registration stopped",
    });

    releaseGate();
    await expect(startPromise).resolves.toBeUndefined();
  });

  it("lists fresh after a toolchange fires while a cached listing is still in flight", async () => {
    readyStatus(1);
    const firstTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    let resolveFirstList!: (tools: unknown[]) => void;
    let toolchangeListener: EventListener | undefined;
    const getTools = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstList = resolve;
          }),
      )
      .mockImplementation(async () => [firstTool]);
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool: vi.fn(async () => ""),
        addEventListener: (type: string, listener: EventListener) => {
          if (type === "toolchange") toolchangeListener = listener;
        },
        removeEventListener: vi.fn(),
      }),
    });

    const firstCall = helper.tools();
    // toolchange fires while the first (cacheable) listing is still pending.
    toolchangeListener?.(new Event("toolchange"));
    resolveFirstList([firstTool]);
    await firstCall;
    expect(getTools).toHaveBeenCalledTimes(1);

    await helper.tools();
    expect(getTools).toHaveBeenCalledTimes(2);
  });

  it("matches every tool for a global RegExp filter instead of alternating misses via shared lastIndex", async () => {
    readyStatus(3);
    // Each description avoids repeating "deck" so a stale, carried-over
    // lastIndex from a prior successful match has nothing later to fall
    // back onto — the classic true/false/true alternation this guards.
    const tools = [
      {
        name: "get-deck",
        description: "Read it",
        window,
        origin: "https://shop.example",
      },
      {
        name: "update-deck",
        description: "Change it",
        window,
        origin: "https://shop.example",
      },
      {
        name: "delete-deck",
        description: "Remove it",
        window,
        origin: "https://shop.example",
      },
    ];
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => tools),
        executeTool: vi.fn(async () => ""),
      }),
    });

    const matches = await helper.tools(/deck/g);
    expect(matches.map((tool) => tool.name)).toEqual([
      "get-deck",
      "update-deck",
      "delete-deck",
    ]);
  });
  it("retries a polyfill-worded stale descriptor the same as native/Codex wording", async () => {
    readyStatus(1);
    const registeredTool = {
      name: "get-order",
      description: "Read an order",
      window,
      origin: "https://shop.example",
    };
    const getTools = vi.fn(async () => [registeredTool]);
    const executeTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("Tool not found: get-order"))
      .mockResolvedValueOnce("shipped");
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools,
        executeTool,
      }),
    });

    const outcome = await helper.call("get-order");
    expect(outcome).toMatchObject({ ok: true, attempts: 2, result: "shipped" });
    expect(getTools).toHaveBeenCalledTimes(2);
  });

  it("requires an origin when the same name is exposed by multiple origins", async () => {
    readyStatus(2);
    const toolA = {
      name: "get-order",
      description: "Read an order (a)",
      window,
      origin: "https://a.example",
    };
    const toolB = {
      name: "get-order",
      description: "Read an order (b)",
      window,
      origin: "https://b.example",
    };
    const executeTool = vi.fn(async () => "shipped");
    const helper = createAgentNativeWebMcpPageHelper({
      document: documentWithModelContext({
        registerTool: vi.fn(async () => {}),
        getTools: vi.fn(async () => [toolA, toolB]),
        executeTool,
      }),
    });

    const ambiguous = await helper.call("get-order");
    expect(ambiguous).toMatchObject({ ok: false, code: "execution-failed" });
    expect((ambiguous as { error?: string }).error).toMatch(/multiple origins/);
    expect(executeTool).not.toHaveBeenCalled();

    const scoped = await helper.call(
      "get-order",
      {},
      { origin: "https://b.example" },
    );
    expect(scoped).toMatchObject({ ok: true, result: "shipped" });
    expect(executeTool).toHaveBeenCalledWith(toolB, "{}", {});
  });
});
