import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../server/credential-provider.js", () => ({
  getBuilderProxyOrigin: () => "https://api.builder.io",
}));

import type { EngineTool } from "./engine/types.js";
import { preloadJevTools, rankJevCandidates } from "./jev-tool-prefetch.js";
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it("prefetches tools through the Builder proxy without a direct key", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            answers: {
              best_tool: {
                choice: "search-customers",
                probabilities: { "search-customers": 0.9, "send-email": 0.1 },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const initialTools = [tool("tool-search", "Find tools")];

    const result = await preloadJevTools({
      request: "Find customer records",
      builderAuth: { authorization: "Bearer builder-test-token" },
      registry: {
        "search-customers": action("Search customer records"),
        "send-email": action("Send an email"),
      },
      initialTools,
      availableTools: [
        ...initialTools,
        tool("search-customers", "Search customer records"),
        tool("send-email", "Send an email"),
      ],
    });

    expect(result.map((item) => item.name)).toEqual([
      "search-customers",
      "send-email",
      "tool-search",
    ]);
    expect(typeSafeClient).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
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

  it("prefers the Builder proxy outside production when Builder auth is available", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "jev-latest",
            answers: {
              best_tool: {
                type: "choice",
                choice: "search-crm",
                probabilities: { "search-crm": 0.9, "send-email": 0.1 },
                confidence: 0.9,
              },
            },
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await rankJevCandidates({
      builderAuth: {
        authorization: "Bearer builder-test-token",
        spaceId: "space-test",
        userId: "user-test",
      },
      request: "Find the customer and email me the record",
      candidates: [
        { id: "search-crm", description: "Search customer records" },
        { id: "send-email", description: "Send an email" },
      ],
      candidateStateKey: "candidate_tools",
      answerKey: "best_tool",
      question: "Which tool is best?",
    });

    expect(result).toEqual(["search-crm", "send-email"]);
    expect(typeSafeClient).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.builder.io/agent-native/jev/v1/system-one",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer builder-test-token",
          "x-builder-api-key": "space-test",
          "x-builder-user-id": "user-test",
        }),
      }),
    );
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string),
    ).toMatchObject({ model: "jev-latest" });
  });

  it("keeps the Builder proxy disabled in production", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production");
    systemOne.mockResolvedValue({
      answers: {
        best_tool: {
          probabilities: { "search-crm": 0.8, "send-email": 0.2 },
        },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      rankJevCandidates({
        apiKey: "jev-test-key",
        builderAuth: {
          authorization: "Bearer builder-test-token",
          spaceId: "space-test",
          userId: "user-test",
        },
        request: "Find the customer",
        candidates: [
          { id: "search-crm", description: "Search customer records" },
          { id: "send-email", description: "Send an email" },
        ],
        candidateStateKey: "candidate_tools",
        answerKey: "best_tool",
        question: "Which tool is best?",
      }),
    ).resolves.toEqual(["search-crm", "send-email"]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it("ranks context candidates from metadata without sending their bodies", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_context: {
          choice: "context-1",
          probabilities: { "context-1": 0.9, "context-0": 0.1 },
        },
      },
    });

    await expect(
      rankJevCandidates({
        apiKey: "jev-test-key",
        request: "draft a launch email",
        candidates: [
          {
            id: "context-0",
            description: "Brand guidelines",
            metadata: { kind: "resource", scope: "workspace" },
          },
          {
            id: "context-1",
            description: "Launch messaging skill",
            metadata: { kind: "skill", scope: "template" },
          },
        ],
        candidateStateKey: "candidate_context",
        answerKey: "best_context",
        question: "Which context applies?",
      }),
    ).resolves.toEqual(["context-1", "context-0"]);

    const state = systemOne.mock.calls.at(-1)?.[0].state;
    expect(state.candidate_context).toEqual([
      {
        id: "context-0",
        description: "Brand guidelines",
        kind: "resource",
        scope: "workspace",
      },
      {
        id: "context-1",
        description: "Launch messaging skill",
        kind: "skill",
        scope: "template",
      },
    ]);
    expect(JSON.stringify(state)).not.toContain("body");
  });

  it("does not promote candidates omitted from an incomplete probability map", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_context: {
          probabilities: { "context-1": 0.9 },
        },
      },
    });

    await expect(
      rankJevCandidates({
        apiKey: "jev-test-key",
        request: "draft a launch email",
        candidates: [
          { id: "context-0", description: "Brand guidelines" },
          { id: "context-1", description: "Launch messaging skill" },
        ],
        candidateStateKey: "candidate_context",
        answerKey: "best_context",
        question: "Which context applies?",
        limit: 3,
      }),
    ).resolves.toEqual(["context-1"]);
  });
});
