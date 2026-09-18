import { beforeEach, describe, expect, it, vi } from "vitest";

const systemOne = vi.hoisted(() => vi.fn());
const typeSafeClient = vi.hoisted(() => vi.fn());

vi.mock("@typesafe-ai/sdk", () => ({
  choice: (instructions: string, criteria: Record<string, string>) => ({
    type: "choice",
    instructions,
    criteria,
  }),
  TypeSafeClient: typeSafeClient,
}));

import type { EngineTool } from "./engine/types.js";
import { preloadJevTools } from "./jev-tool-prefetch.js";
import type { ActionEntry } from "./production-agent.js";

function action(description: string): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    http: false,
    readOnly: true,
    run: async () => "ok",
  };
}

function tool(name: string, description: string): EngineTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
  };
}

describe("preloadJevTools", () => {
  beforeEach(() => {
    systemOne.mockReset();
    typeSafeClient.mockReset();
    typeSafeClient.mockImplementation(
      class TypeSafeClient {
        systemOne = systemOne;
      },
    );
  });

  it("does not import or call Jev without a saved key", async () => {
    const initialTools = [tool("tool-search", "Find tools")];
    const result = await preloadJevTools({
      request: "Find customer records",
      registry: { "search-customers": action("Search customer records") },
      initialTools,
      availableTools: [
        ...initialTools,
        tool("search-customers", "Search customer records"),
      ],
    });

    expect(result).toBe(initialTools);
    expect(typeSafeClient).not.toHaveBeenCalled();
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("puts Jev's highest-probability deferred tools before the curated set", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_tool: {
          choice: "search-crm",
          probabilities: {
            "search-crm": 0.7,
            "send-email": 0.2,
            "create-task": 0.1,
          },
        },
      },
    });
    const initialTools = [tool("tool-search", "Find tools")];
    const availableTools = [
      ...initialTools,
      tool("send-email", "Send an email"),
      tool("create-task", "Create a task"),
      tool("search-crm", "Search customer records"),
    ];

    const result = await preloadJevTools({
      apiKey: "jev-test-key",
      request: "Find the customer and email me the record",
      registry: {
        "send-email": action("Send an email"),
        "create-task": action("Create a task"),
        "search-crm": action("Search customer records"),
      },
      initialTools,
      availableTools,
    });

    expect(result.slice(0, 4).map((item) => item.name)).toEqual([
      "search-crm",
      "send-email",
      "create-task",
      "tool-search",
    ]);
    expect(typeSafeClient).toHaveBeenCalledWith({
      apiKey: "jev-test-key",
      timeout: 750,
      retry: { maxRetries: 0 },
    });
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0][0].state.task).toContain("customer");
  });

  it("falls back to the curated set when Jev is unavailable", async () => {
    systemOne.mockRejectedValue(new Error("timeout"));
    const initialTools = [tool("tool-search", "Find tools")];
    const result = await preloadJevTools({
      apiKey: "jev-test-key",
      request: "Search customer records",
      registry: {
        "search-customers": action("Search customer records"),
        "list-customers": action("List customer records"),
      },
      initialTools,
      availableTools: [
        ...initialTools,
        tool("search-customers", "Search customer records"),
        tool("list-customers", "List customer records"),
        tool("send-email", "Send an email"),
      ],
    });

    expect(result).toBe(initialTools);
  });
});
