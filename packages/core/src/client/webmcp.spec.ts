// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

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
  initializeAgentNativeWebMcp,
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
