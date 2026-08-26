// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { AgentNativeClientAction } from "./host-bridge.js";
import {
  AgentNativeWebMcpUnsupportedError,
  createAgentNativeWebMcpClient,
  createAgentNativeWebMcpRegistration,
} from "./webmcp.js";

function documentWithModelContext(modelContext: Record<string, unknown>) {
  return { modelContext } as unknown as Document;
}

describe("WebMCP client", () => {
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
