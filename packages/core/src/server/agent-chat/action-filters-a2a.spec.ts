import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  toolCallCacheKey,
  type ActionEntry,
} from "../../agent/production-agent.js";
import type { AgentChatEvent } from "../../agent/types.js";
import type { AuditEvent } from "../../audit/types.js";
import { CORE_ACTION_GROUPS } from "../../framework-tools.js";
import {
  getRequestRunContext,
  runWithRequestContext,
} from "../request-context.js";
import {
  assembleA2AFinalResponse,
  buildAuthenticatedAgentA2ASkills,
  buildPublicAgentA2ASkills,
  executeApprovedA2AToolCall,
  filterDelegatedA2ACapabilityActions,
  filterDirectA2AActions,
  filterMcpOnlyActions,
  resolveInitialToolNames,
  runA2AAgentLoop,
  runMCPAgentLoop,
} from "./action-filters-a2a.js";

const auditRows = vi.hoisted(() => [] as AuditEvent[]);
const taskEvents = vi.hoisted(() => new Map<string, AgentChatEvent[]>());

vi.mock("../../audit/store.js", () => ({
  insertAuditEvent: async (event: AuditEvent) => {
    auditRows.push(event);
  },
}));
vi.mock("../../agent/run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agent/run-store.js")>()),
  getCurrentTurnEventsForThread: async (threadId: string) =>
    taskEvents.get(threadId) ?? [],
}));

function action(overrides: Partial<ActionEntry> = {}): ActionEntry {
  return {
    tool: { description: "Read", parameters: { type: "object" } },
    run: vi.fn(),
    http: { method: "GET" },
    readOnly: true,
    publicAgent: {
      expose: true,
      readOnly: true,
      requiresAuth: true,
      isConsequential: false,
    },
    ...overrides,
  };
}

describe("executeApprovedA2AToolCall", () => {
  it("runs the approved call once, outside the paused task's journal, and links its row to the task", async () => {
    const input = { to: "ceo@example.test" };
    const approvalKey = toolCallCacheKey("send-email", input);
    // The paused task already holds an identical completed call; read as the
    // replay's journal, it would stand in for the approved one.
    taskEvents.set("task-1", [
      { type: "tool_start", id: "call-0", tool: "send-email", input },
      {
        type: "tool_done",
        id: "call-0",
        tool: "send-email",
        input,
        result: "sent earlier",
        completedSideEffect: true,
      },
    ]);
    auditRows.length = 0;
    const sent = vi.fn(async () => "sent");
    const sendEmail = defineAction({
      description: "Send an email",
      schema: z.object({ to: z.string() }),
      http: { method: "POST" },
      needsApproval: true,
      run: async (_args, ctx) => sent(ctx),
    }) as ActionEntry;

    const result = await executeApprovedA2AToolCall(
      {
        id: "approval-1",
        taskId: "task-1",
        ownerEmail: "owner@example.test",
        orgId: "org-1",
        tool: "send-email",
        input,
        approvalKey,
        callId: "call-1",
      },
      { actions: { "send-email": sendEmail }, appId: "mail" },
    );

    expect(result).toEqual({ status: "completed", output: "sent" });
    expect(sent).toHaveBeenCalledOnce();
    const ctx = sent.mock.calls[0]![0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      userEmail: "owner@example.test",
      orgId: "org-1",
      caller: "tool",
      approvedToolCallKey: approvalKey,
    });
    for (const key of [
      "threadId",
      "turnId",
      "runId",
      "networkProtocol",
      "networkId",
    ]) {
      expect(ctx[key]).toBeUndefined();
    }
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "send-email",
      status: "success",
      actorEmail: "owner@example.test",
      threadId: "task-1",
      turnId: "task-1",
      runId: "task-1",
      networkProtocol: "a2a",
      networkId: "task-1",
      networkPeer: null,
      approval: "a2a-review",
    });
  });
});

describe("delegated agent loops", () => {
  it.each([
    ["A2A", runA2AAgentLoop],
    ["ask_app", runMCPAgentLoop],
  ])(
    "keep the %s run context on the model and effort each call uses",
    async (_name, runLoop) => {
      const seen: unknown[] = [];
      await runWithRequestContext(
        { userEmail: "owner@example.test", run: { model: "claude-haiku-4-5" } },
        () =>
          runLoop(
            {
              model: "claude-haiku-4-5",
              reasoningEffort: "high",
              onModelSettings: (model, effort) => seen.push([model, effort]),
            } as Parameters<typeof runLoop>[0],
            {},
            undefined,
            {
              runner: (async (loopOptions: Parameters<typeof runLoop>[0]) => {
                loopOptions.onModelSettings?.("claude-haiku-4-5", "high");
                loopOptions.onModelSettings?.("claude-sonnet-5", "medium");
                const run = getRequestRunContext();
                seen.push([run?.model, run?.reasoningEffort]);
              }) as never,
            },
          ),
      );

      expect(seen).toEqual([
        ["claude-haiku-4-5", "high"],
        ["claude-sonnet-5", "medium"],
        ["claude-sonnet-5", "medium"],
      ]);
    },
  );
});

describe("assembleA2AFinalResponse", () => {
  it("preserves the agent loop error code as structured terminal data", () => {
    let thrown: unknown;
    try {
      assembleA2AFinalResponse([], [], {
        outcome: {
          state: "failed",
          code: "missing_credentials",
          retryable: false,
          message: "The provider connection is missing.",
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: "The provider connection is missing.\ncode: missing_credentials",
      agentNativeErrorCode: "missing_credentials",
    });
  });
});

describe("filterDirectA2AActions", () => {
  it("publishes input schemas for public and authenticated skill cards", () => {
    const inputSchema = {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    };

    const publicSkills = buildPublicAgentA2ASkills({
      public: action({
        tool: { description: "Ask", parameters: inputSchema },
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: false,
        },
      }),
    });
    const authenticatedSkills = buildAuthenticatedAgentA2ASkills(
      {
        authenticated: action({
          tool: { description: "Ask", parameters: inputSchema },
        }),
      },
      { connectorCatalog: ["authenticated"] },
    );

    expect(publicSkills[0]?.inputSchema).toEqual(inputSchema);
    expect(authenticatedSkills[0]?.readOnly).toBe(true);
    expect(authenticatedSkills[0]?.inputSchema).toEqual(inputSchema);
  });

  it("never exposes a raw query or code input to a sibling app", () => {
    const rawInput = (field: string) =>
      action({
        tool: {
          description: "Run it",
          parameters: {
            type: "object",
            properties: { [field]: { type: "string" } },
            required: [field],
          },
        },
      });
    const actions = {
      "raw-sql": rawInput("sql"),
      "raw-code": rawInput("code"),
      "raw-script": rawInput("script"),
      "raw-expression": rawInput("expression"),
      "raw-optional-sql": action({
        tool: {
          description: "Run optional SQL",
          parameters: {
            type: "object",
            properties: { sql: { type: ["string", "null"] } },
          },
        },
      }),
      "search-text": rawInput("query"),
      semantic: action({
        tool: {
          description: "Metrics",
          parameters: {
            type: "object",
            properties: { days: { type: "number" } },
          },
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: Object.keys(actions),
        }),
      ).sort(),
    ).toEqual(["search-text", "semantic"]);
  });

  it("reads `mcpTool` as catalog membership and as a veto", () => {
    const actions = {
      "list-plans": action({ mcpTool: true }),
      "get-plan": action(),
      "open-inspector": action({ mcpTool: false }),
    };

    expect(Object.keys(filterDirectA2AActions(actions, {}))).toEqual([
      "list-plans",
    ]);

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: ["get-plan", "open-inspector"],
        }),
      ).sort(),
    ).toEqual(["get-plan", "list-plans"]);
  });

  it("inherits agentTool when mcpTool is undefined, and lets mcpTool override it", () => {
    const actions = {
      "hidden-read": action({ agentTool: false }),
      "mcp-only-read": action({ agentTool: false, mcpTool: true }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: ["hidden-read", "mcp-only-read"],
        }),
      ),
    ).toEqual(["mcp-only-read"]);

    expect(Object.keys(filterDirectA2AActions(actions, {}))).toEqual([
      "mcp-only-read",
    ]);
  });

  it("collects only the MCP-only actions for the external mounts", () => {
    expect(
      Object.keys(
        filterMcpOnlyActions({
          "mcp-only": action({ agentTool: false, mcpTool: true }),
          "agent-hidden": action({ agentTool: false }),
          "catalog-member": action({ mcpTool: true }),
          normal: action(),
        }),
      ),
    ).toEqual(["mcp-only"]);
  });

  it("allows a raw query input only with an explicit opt-in", () => {
    const actions = {
      "raw-sql": action({
        tool: {
          description: "Run SQL",
          parameters: {
            type: "object",
            properties: { sql: { type: "string" } },
            required: ["sql"],
          },
        },
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: true,
          allowRawQueryInput: true,
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, { connectorCatalog: ["raw-sql"] }),
      ),
    ).toEqual(["raw-sql"]);
  });

  it("allows only cataloged authenticated reads", () => {
    const actions = {
      allowed: action(),
      uncataloged: action(),
      mutation: action({ readOnly: false }),
      hidden: action({ agentTool: false }),
      approval: action({ needsApproval: true }),
      public: action({
        publicAgent: {
          expose: true,
          readOnly: true,
          requiresAuth: false,
        },
      }),
    };

    expect(
      Object.keys(
        filterDirectA2AActions(actions, {
          connectorCatalog: [
            "allowed",
            "mutation",
            "hidden",
            "approval",
            "public",
          ],
        }),
      ),
    ).toEqual(["allowed"]);
  });

  it("supports authenticated-read auto exposure while honoring denyActions", () => {
    const result = filterDirectA2AActions(
      {
        allowed: action(),
        denied: action(),
        post: action({ http: { method: "POST" } }),
        "db-query": action(),
        "seed-demo": action(),
        "list-extensions": action(),
        "list-browser-sessions": action(),
      },
      {
        externalAgents: {
          authenticatedReads: "auto",
          denyActions: ["denied"],
        },
      },
    );

    expect(Object.keys(result)).toEqual(["allowed"]);
  });

  it("advertises exposed writes as message-only delegated capabilities", () => {
    const write = action({
      tool: {
        description: "Create a campaign.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
      http: { method: "POST" },
      readOnly: false,
      publicAgent: {
        expose: true,
        readOnly: false,
        requiresAuth: true,
      },
    });

    const skills = buildAuthenticatedAgentA2ASkills(
      { "create-campaign": write },
      {},
    );

    expect(skills).toEqual([
      {
        id: "create-campaign",
        name: "create-campaign",
        description: "Create a campaign.",
        publicAgent: write.publicAgent,
        readOnly: false,
      },
    ]);
    expect(skills[0]).not.toHaveProperty("inputSchema");
    expect(filterDirectA2AActions({ "create-campaign": write }, {})).toEqual(
      {},
    );
    expect(buildPublicAgentA2ASkills({ "create-campaign": write })).toEqual([]);
  });

  it("applies agentTool and deny policy to delegated capabilities", () => {
    const write = (overrides: Partial<ActionEntry> = {}) =>
      action({
        http: { method: "POST" },
        readOnly: false,
        publicAgent: {
          expose: true,
          readOnly: false,
          requiresAuth: true,
        },
        ...overrides,
      });
    const actions = {
      allowed: write(),
      denied: write(),
      hidden: write({ agentTool: false }),
      unexposed: write({ publicAgent: undefined }),
    };

    expect(
      Object.keys(
        filterDelegatedA2ACapabilityActions(actions, {
          externalAgents: { denyActions: ["denied"] },
        }),
      ),
    ).toEqual(["allowed"]);
  });
});

describe("resolveInitialToolNames", () => {
  it("keeps core framework kits out of the default first-request list", () => {
    const untagged = Object.fromEntries(
      Object.keys(CORE_ACTION_GROUPS).map((name) => [name, action()]),
    );

    expect(
      resolveInitialToolNames({ ...untagged, "create-form": action() }),
    ).toEqual(["create-form"]);
  });

  it("does not mistake an app action for a kit it merely resembles", () => {
    expect(resolveInitialToolNames({ "share-portfolio": action() })).toEqual([
      "share-portfolio",
    ]);
  });

  it("returns the configured list verbatim when one is given", () => {
    expect(
      resolveInitialToolNames({ "share-resource": action() }, [
        "share-resource",
      ]),
    ).toEqual(["share-resource"]);
  });

  it("narrows the derived list to the actions that opted out of deferral", () => {
    expect(
      resolveInitialToolNames({
        "list-forms": action({ deferLoading: false }),
        "create-form": action({ deferLoading: false }),
        "export-form-archive": action(),
      }),
    ).toEqual(["list-forms", "create-form"]);
  });

  it("drops `deferLoading: true` from the derived list", () => {
    expect(
      resolveInitialToolNames({
        "list-forms": action(),
        "export-form-archive": action({ deferLoading: true }),
      }),
    ).toEqual(["list-forms"]);
  });

  it("adds eager actions to a configured list without duplicating it", () => {
    expect(
      resolveInitialToolNames(
        {
          "list-forms": action({ deferLoading: false }),
          "create-form": action({ deferLoading: false }),
          "export-form-archive": action(),
        },
        ["list-forms", "export-form-archive"],
      ),
    ).toEqual(["list-forms", "export-form-archive", "create-form"]);
  });

  it("keeps a configured name that the action marked deferred", () => {
    expect(
      resolveInitialToolNames(
        { "export-form-archive": action({ deferLoading: true }) },
        ["export-form-archive"],
      ),
    ).toEqual(["export-form-archive"]);
  });

  it("honors `deferLoading: false` on a framework kit action", () => {
    const [kitName] = Object.keys(CORE_ACTION_GROUPS);
    expect(
      resolveInitialToolNames({
        [kitName]: action({ deferLoading: false }),
        "create-form": action(),
      }),
    ).toEqual([kitName]);
  });
});
