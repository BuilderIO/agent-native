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
import {
  isBuilderJevEnabled,
  isJevEnabled,
  preloadJevTools,
  rankJevCandidates,
  requestJevThroughBuilder,
} from "./jev-tool-prefetch.js";
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
      function TypeSafeClient(this: {
        handler: typeof systemOne;
        systemOne: (request: unknown) => unknown;
      }) {
        this.handler = systemOne;
        this.systemOne = function (request: unknown) {
          return this.handler(request);
        };
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

  it("keeps curated tools when even the only deferred tool is irrelevant", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_tool: {
          choice: "__no_match__",
          probabilities: { __no_match__: 0.95, "search-customers": 0.05 },
        },
      },
    });
    const initialTools = [tool("tool-search", "Find tools")];

    const result = await preloadJevTools({
      personalApiKey: "jev-test-key",
      request: "Write a poem",
      registry: { "search-customers": action("Search customer records") },
      initialTools,
      availableTools: [
        ...initialTools,
        tool("search-customers", "Search customer records"),
      ],
    });

    expect(result).toBe(initialTools);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(
      systemOne.mock.calls[0][0].questions.best_tool.criteria,
    ).toHaveProperty("__no_match__");
  });

  it("prefetches only candidates more likely than no match", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_tool: {
          choice: "search-customers",
          probabilities: {
            "search-customers": 0.6,
            __no_match__: 0.3,
            "send-email": 0.1,
          },
        },
      },
    });
    const initialTools = [tool("tool-search", "Find tools")];

    const result = await preloadJevTools({
      personalApiKey: "jev-test-key",
      request: "Find a customer record",
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
      "tool-search",
    ]);
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
                probabilities: {
                  "search-customers": 0.9,
                  "send-email": 0.1,
                  __no_match__: 0,
                },
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
            __no_match__: 0,
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
      personalApiKey: "jev-test-key",
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
      personalApiKey: "jev-test-key",
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
                probabilities: {
                  "search-crm": 0.9,
                  "send-email": 0.1,
                  __no_match__: 0,
                },
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

  it("does not use a deployment Jev key without Builder auth", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const initialTools = [tool("tool-search", "Find tools")];

    await expect(
      preloadJevTools({
        apiKey: "deployment-jev-key",
        request: "Find customer records",
        registry: {
          "search-customers": action("Search customers"),
          "list-customers": action("List customers"),
        },
        initialTools,
        availableTools: [
          ...initialTools,
          tool("search-customers", "Search customers"),
          tool("list-customers", "List customers"),
        ],
      }),
    ).resolves.toBe(initialTools);
    expect(typeSafeClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the Builder proxy in production when Builder auth is available", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            answers: {
              best_tool: {
                choice: "search-crm",
                probabilities: {
                  "search-crm": 0.8,
                  "send-email": 0.2,
                  __no_match__: 0,
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      rankJevCandidates({
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

    expect(fetch).toHaveBeenCalled();
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("does not bypass a Builder Jev denial with a deployment key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })),
    );

    await expect(
      rankJevCandidates({
        request: "Find customer records",
        apiKey: "deployment-jev-key",
        builderAuth: { authorization: "Bearer builder-test-token" },
        candidates: [
          { id: "search-customers", description: "Search customers" },
          { id: "list-customers", description: "List customers" },
        ],
        candidateStateKey: "candidate_tools",
        answerKey: "best_tool",
        question: "Choose the best tool.",
      }),
    ).resolves.toEqual([]);

    expect(typeSafeClient).not.toHaveBeenCalled();
  });

  it("uses an explicitly saved Jev key after a Builder denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })),
    );
    systemOne.mockResolvedValue({
      answers: {
        best_tool: {
          choice: "search-customers",
          probabilities: { "search-customers": 0.9, __no_match__: 0.1 },
        },
      },
    });

    await expect(
      rankJevCandidates({
        request: "Find customer records",
        apiKey: "deployment-jev-key",
        personalApiKey: " personal-jev-key ",
        builderAuth: { authorization: "Bearer builder-test-token" },
        candidates: [
          { id: "search-customers", description: "Search customers" },
          { id: "list-customers", description: "List customers" },
        ],
        candidateStateKey: "candidate_tools",
        answerKey: "best_tool",
        question: "Choose the best tool.",
      }),
    ).resolves.toEqual(["search-customers"]);

    expect(typeSafeClient).toHaveBeenCalledWith({
      apiKey: "personal-jev-key",
      timeout: 750,
      retry: { maxRetries: 0 },
    });
  });

  it("preserves Jev question types through the Builder proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            answers: { q_0: { noul: 0.9 } },
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200 },
        ),
      ),
    );
    const request = {
      model: "jev-latest",
      state: { emails: [{ id: "message-1" }] },
      questions: {
        q_0: {
          type: "noul",
          instructions: "Should this email be prioritized?",
          criteria: { true: "Prioritize", false: "Do not prioritize" },
        },
      },
    };

    await expect(
      requestJevThroughBuilder(
        {
          authorization: "Bearer builder-test-token",
          spaceId: "builder-space-1",
          userId: "builder-user-1",
        },
        request,
        { timeoutMs: 12_000 },
      ),
    ).resolves.toMatchObject({ answers: { q_0: { noul: 0.9 } } });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.builder.io/agent-native/jev/v1/system-one");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer builder-test-token");
    expect(headers.get("x-builder-api-key")).toBe("builder-space-1");
    expect(headers.get("x-builder-user-id")).toBe("builder-user-1");
    expect(headers.get("x-client-name")).toBe("@agent-native/core");
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it.each([429, 529])(
    "retries Builder Jev inference once after HTTP %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(new Response("busy", { status }))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ answers: { q_0: { noul: 0.9 } } }), {
              status: 200,
            }),
          ),
      );

      await expect(
        requestJevThroughBuilder(
          { authorization: "Bearer builder-test-token" },
          { model: "jev-latest", state: {}, questions: { q_0: {} } },
          { timeoutMs: 12_000 },
        ),
      ).resolves.toMatchObject({ answers: { q_0: { noul: 0.9 } } });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBe(
        vi.mocked(fetch).mock.calls[1]?.[1]?.signal,
      );
    },
  );

  it("does not retry Builder Jev inference after the caller aborts", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementationOnce(async () => {
        controller.abort("cancelled");
        return new Response("busy", { status: 429 });
      }),
    );

    await expect(
      requestJevThroughBuilder(
        { authorization: "Bearer builder-test-token" },
        { model: "jev-latest", state: {}, questions: { q_0: {} } },
        { signal: controller.signal, timeoutMs: 12_000 },
      ),
    ).rejects.toBe("cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks Builder Jev entitlement without running inference", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ enabled: true }), { status: 200 }),
        ),
    );
    const auth = {
      authorization: "Bearer builder-test-token",
      spaceId: "builder-space-1",
      userId: "builder-user-1",
    };

    await expect(
      isJevEnabled({
        apiKey: undefined,
        personalApiKey: undefined,
        builderAuth: auth,
      }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.builder.io/agent-native/jev/v1/status",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer builder-test-token",
          "x-builder-api-key": "builder-space-1",
          "x-builder-user-id": "builder-user-1",
        }),
      }),
    );
  });

  it("treats Builder Jev entitlement denial as disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })),
    );

    await expect(
      isBuilderJevEnabled({ authorization: "Bearer builder-test-token" }),
    ).resolves.toBe(false);
  });

  it("does not expose Jev features from a deployment key alone", async () => {
    await expect(
      isJevEnabled({
        apiKey: "deployment-jev-key",
        personalApiKey: undefined,
        builderAuth: null,
      }),
    ).resolves.toBe(false);
  });

  it("enables Jev features for a saved personal key", async () => {
    await expect(
      isJevEnabled({
        apiKey: "personal-jev-key",
        personalApiKey: "personal-jev-key",
        builderAuth: null,
      }),
    ).resolves.toBe(true);
  });

  it("does not report Jev disabled when saved-key lookup failed", async () => {
    await expect(
      isJevEnabled({
        apiKey: undefined,
        personalApiKey: undefined,
        builderAuth: null,
        apiKeyLookupFailed: true,
      }),
    ).rejects.toThrow(
      "Could not check Jev credentials or Builder entitlement.",
    );
  });

  it("does not report Jev disabled when Builder entitlement lookup failed", async () => {
    await expect(
      isJevEnabled({
        apiKey: undefined,
        personalApiKey: undefined,
        builderAuth: null,
        builderAuthLookupFailed: true,
      }),
    ).rejects.toThrow(
      "Could not check Jev credentials or Builder entitlement.",
    );
  });

  it("uses a saved personal key when Builder entitlement lookup failed", async () => {
    await expect(
      isJevEnabled({
        apiKey: "personal-jev-key",
        personalApiKey: "personal-jev-key",
        builderAuth: null,
        builderAuthLookupFailed: true,
      }),
    ).resolves.toBe(true);
  });

  it("ranks context candidates from metadata without sending their bodies", async () => {
    systemOne.mockResolvedValue({
      answers: {
        best_context: {
          choice: "context-1",
          probabilities: {
            "context-1": 0.9,
            "context-0": 0.1,
            __no_match__: 0,
          },
        },
      },
    });

    await expect(
      rankJevCandidates({
        apiKey: "jev-test-key",
        personalApiKey: "jev-test-key",
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
          probabilities: { "context-1": 0.9, __no_match__: 0.1 },
        },
      },
    });

    await expect(
      rankJevCandidates({
        apiKey: "jev-test-key",
        personalApiKey: "jev-test-key",
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

  it("keeps the existing context when Jev omits the no-match probability", async () => {
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
          { id: "context-0", description: "Brand guidelines" },
          { id: "context-1", description: "Launch messaging skill" },
        ],
        candidateStateKey: "candidate_context",
        answerKey: "best_context",
        question: "Which context applies?",
      }),
    ).resolves.toEqual([]);
  });

  it.each([2, -0.2])(
    "rejects out-of-range candidate probability %s",
    async (invalidProbability) => {
      systemOne.mockResolvedValue({
        answers: {
          best_context: {
            choice: "context-1",
            probabilities: {
              "context-1": invalidProbability,
              "context-0": 0.1,
              __no_match__: 0.2,
            },
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
        }),
      ).resolves.toEqual([]);
    },
  );
});
