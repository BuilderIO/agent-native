import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { AuditEvent } from "./types.js";

const recorded = vi.hoisted(() => [] as AuditEvent[]);

vi.mock("./store.js", () => ({
  insertAuditEvent: async (event: AuditEvent) => {
    recorded.push(event);
  },
}));
vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async () => "owner",
  readPersonalProviderKeyPolicy: async () => ({
    restricted: false,
    updatedAt: null,
    updatedBy: null,
  }),
  writePersonalProviderKeyPolicy: async () => ({
    changed: true,
    policy: { restricted: true, updatedAt: 1, updatedBy: "owner@example.test" },
  }),
}));
vi.mock("../server/personal-provider-key-holders.js", () => ({
  listPersonalProviderKeyHolders: async () => [],
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async () => null,
  mutateSetting: async (_key: string, update: (value: null) => unknown) =>
    update(null),
}));
vi.mock("../server/credential-provider.js", () => ({
  prefetchSecrets: async () => undefined,
  resolveBuilderCredentialsDetailed: async () => ({
    privateKey: null,
    publicKey: null,
    source: null,
    lookupFailed: false,
  }),
}));
vi.mock("../server/secret-key-aliases.js", () => ({
  secretKeyNames: (key: string) => [key],
  resolveSecretWithAliasesDetailed: async () => ({
    value: null,
    lookupFailed: false,
  }),
}));
// An agent team's task message queue, empty.
vi.mock("../application-state/script-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../application-state/script-helpers.js")
  >()),
  listAppState: async () => [],
  readAppState: async () => null,
}));

const { default: manageProviderKeyPolicy } =
  await import("../agent/actions/manage-provider-key-policy.js");
const { default: manageServiceProviders } =
  await import("../agent/actions/manage-service-providers.js");
const { recordOrgAdminAuditEvent } = await import("./org-admin.js");
const { auditAttribution, routeAuditAttribution } =
  await import("./attribution.js");
const { markVerifiedMcpCredentialForEvent } =
  await import("../server/request-context.js");
const { ACTION_EXECUTION_KEY, defineAction, runActionInvocation } =
  await import("../action.js");
const { executeAgentToolCall, toolCallCacheKey } =
  await import("../agent/production-agent.js");
const { _agentTeamsQueueForTests } = await import("../server/agent-teams.js");
const { createRunCodeEntry } = await import("../coding-tools/run-code.js");
const { executeApprovedA2AToolCall } =
  await import("../server/agent-chat/action-filters-a2a.js");

const OWNER = "owner@example.test";

const mcpCall = {
  userEmail: OWNER,
  orgId: "org-1",
  caller: "mcp" as const,
  mcpClient: {
    name: "Example Client",
    version: "1.0",
    oauthClientId: "example-oauth-client",
  },
};

function roleChange(event: { context?: Record<string, unknown> }) {
  return recordOrgAdminAuditEvent({
    action: "change-member-role",
    targetType: "org-member-role",
    targetId: "member@example.test",
    summary: "Changed member@example.test from member to admin",
    userEmail: OWNER,
    orgId: "org-1",
    attribution: routeAuditAttribution(event),
  });
}

beforeEach(() => {
  recorded.length = 0;
  delete process.env.AGENT_NATIVE_AUDIT_ENABLED;
});

describe("admin writes recorded outside the action's own audit", () => {
  it("keep the MCP client, OAuth client and approval of a provider key policy change", async () => {
    await runActionInvocation(
      manageProviderKeyPolicy,
      { set: true },
      { ...mcpCall, actionName: "manage-provider-key-policy" },
      { mcpClientAccepted: true },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "manage-provider-key-policy",
      caller: "mcp",
      actorKind: "agent",
      reportedClientName: "Example Client",
      reportedClientVersion: "1.0",
      oauthClientId: "example-oauth-client",
      approval: "mcp-client-accepted",
    });
  });

  it("keep the MCP client, OAuth client and approval of a service provider choice", async () => {
    await runActionInvocation(
      manageServiceProviders,
      { service: "voice", provider: "gemini" },
      { ...mcpCall, actionName: "manage-service-providers" },
      { mcpClientAccepted: true },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "manage-service-providers",
      caller: "mcp",
      actorKind: "agent",
      reportedClientName: "Example Client",
      reportedClientVersion: "1.0",
      oauthClientId: "example-oauth-client",
      approval: "mcp-client-accepted",
    });
  });

  it("record a route write from the UI as the person over http", async () => {
    await roleChange({ context: {} });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      caller: "http",
      actorKind: "human",
      actorEmail: OWNER,
      reportedClientName: null,
      reportedClientVersion: null,
      oauthClientId: null,
      approval: null,
    });
  });

  it("record a route write under a verified MCP credential as the agent with its OAuth client", async () => {
    const event = { context: {} };
    markVerifiedMcpCredentialForEvent(event, {
      userEmail: OWNER,
      oauthClientId: "example-oauth-client",
    });

    await roleChange(event);

    expect(recorded[0]).toMatchObject({
      caller: "mcp",
      actorKind: "agent",
      actorEmail: OWNER,
      oauthClientId: "example-oauth-client",
      reportedClientName: null,
      approval: null,
    });
  });
});

const TASK = "task-review";
const replayIds = {
  threadId: TASK,
  turnId: TASK,
  runId: TASK,
  networkProtocol: "a2a",
  networkId: TASK,
} as const;
const noReplayIds = {
  threadId: null,
  turnId: null,
  runId: null,
  networkProtocol: null,
  networkId: null,
};

function replay(name: string, entry: unknown, input: object = {}, task = TASK) {
  return executeApprovedA2AToolCall(
    {
      id: `approval-${task}`,
      taskId: task,
      ownerEmail: OWNER,
      orgId: "org-1",
      tool: name,
      input,
      approvalKey: toolCallCacheKey(name, input),
      callId: `call-${task}`,
    },
    { actions: { [name]: entry as ActionEntry } },
  );
}

function selfAudit(action: string, ctx: ActionRunContext | undefined) {
  return recordOrgAdminAuditEvent({
    action,
    targetType: "setting",
    summary: "Changed a setting",
    userEmail: ctx?.userEmail,
    orgId: ctx?.orgId,
    attribution: auditAttribution(ctx),
  });
}

function approvalGated(run: (args: object, ctx?: ActionRunContext) => unknown) {
  return defineAction({
    description: "Change a setting",
    schema: z.object({}),
    needsApproval: true,
    run: (args, ctx) => run(args, ctx),
  });
}

function rows() {
  return recorded.map((row) => [row.action, row.threadId, row.approval]);
}

describe("an approved A2A replay's audit override", () => {
  it.each([
    ["manage-provider-key-policy", manageProviderKeyPolicy, { set: true }],
    [
      "manage-service-providers",
      manageServiceProviders,
      { service: "voice", provider: "gemini" },
    ],
  ])("reaches the row %s records itself", async (name, action, input) => {
    expect((await replay(name, action, input)).status).toBe("completed");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: name,
      ...replayIds,
      approval: "a2a-review",
    });
  });

  it("reaches the approved action's own row and a row its body records", async () => {
    const action = approvalGated(async (_args, ctx) => {
      await selfAudit("self-audited", ctx);
      return "changed";
    });

    expect((await replay("approved", action)).status).toBe("completed");

    expect(rows()).toEqual([
      ["self-audited", TASK, "a2a-review"],
      ["approved", TASK, "a2a-review"],
    ]);
    expect(recorded[1]).toMatchObject(replayIds);
  });

  it("does not reach a child given a copy of the approved action's context", async () => {
    const child = defineAction({
      description: "Child",
      schema: z.object({}),
      run: async () => "child done",
    });
    const parent = approvalGated(async (_args, ctx) =>
      child.run({}, { ...ctx!, actionName: "child" }),
    );

    expect((await replay("parent", parent)).status).toBe("completed");

    expect(rows()).toEqual([
      ["child", null, null],
      ["parent", TASK, "a2a-review"],
    ]);
    expect(recorded[0]).toMatchObject(noReplayIds);
  });

  it.each(["defineAction", "raw"])(
    "does not reach a child called with the %s parent's own context object",
    async (kind) => {
      const seen: unknown[] = [];
      const child = defineAction({
        description: "Child",
        schema: z.object({}),
        run: async (_args, ctx) => {
          const { threadId, approval, approvedToolCallKey } =
            auditAttribution(ctx);
          seen.push({ threadId, approval, approvedToolCallKey });
          return "child done";
        },
      });
      const run = (_args: unknown, ctx?: ActionRunContext) =>
        child.run({}, ctx);
      const parent =
        kind === "raw"
          ? {
              tool: { description: "Parent", parameters: { type: "object" } },
              needsApproval: true,
              run,
            }
          : approvalGated(run);

      expect((await replay("parent", parent)).status).toBe("completed");

      expect(seen).toEqual([
        {
          threadId: undefined,
          approval: undefined,
          approvedToolCallKey: undefined,
        },
      ]);
      // The child's row comes first; only a defineAction parent writes one.
      expect(rows()).toEqual(
        kind === "raw"
          ? [["parent", null, null]]
          : [
              ["parent", null, null],
              ["parent", TASK, "a2a-review"],
            ],
      );
    },
  );

  it("does not reach the approved action calling itself with its own context", async () => {
    let calls = 0;
    const action: ReturnType<typeof approvalGated> = approvalGated(
      async (_args, ctx) => {
        calls += 1;
        if (calls === 1) await action.run({}, ctx);
        await selfAudit("self-audited", ctx);
        return "changed";
      },
    );

    expect((await replay("recursive", action)).status).toBe("completed");

    expect(calls).toBe(2);
    expect(rows()).toEqual([
      ["self-audited", null, null],
      ["recursive", null, null],
      ["self-audited", TASK, "a2a-review"],
      ["recursive", TASK, "a2a-review"],
    ]);
  });

  it("does not outlive the approved invocation for a context kept after it", async () => {
    let kept: ActionRunContext | undefined;
    const action = approvalGated(async (_args, ctx) => {
      kept = ctx;
      return "changed";
    });
    expect((await replay("kept", action)).status).toBe("completed");
    recorded.length = 0;

    await action.run({}, kept);

    expect(rows()).toEqual([["kept", null, null]]);
    expect(recorded[0]).toMatchObject(noReplayIds);
  });

  it.each([
    [
      "an agent team's message-aware wrapper",
      (action: ActionEntry) =>
        _agentTeamsQueueForTests.createMessageAwareActions("team-task", {
          wrapped: action,
        }).wrapped!,
    ],
    [
      "a wrapper forwarding the context it is given",
      (action: ActionEntry): ActionEntry => ({
        ...action,
        run: (args, ctx) => action.run(args, ctx),
      }),
    ],
  ])(
    "reaches the approved action through %s, which keeps its execution key",
    async (_name, wrap) => {
      const action = approvalGated(async () => "changed") as ActionEntry;

      expect((await replay("wrapped", wrap(action))).status).toBe("completed");

      expect(rows()).toEqual([["wrapped", TASK, "a2a-review"]]);
    },
  );

  it("does not reach an action behind a wrapper that drops its execution key", async () => {
    const action = approvalGated(async () => "changed") as ActionEntry;
    const wrapper: ActionEntry = {
      ...action,
      run: (args, ctx) => action.run(args, ctx),
    };
    delete (wrapper as unknown as Record<symbol, unknown>)[
      ACTION_EXECUTION_KEY
    ];

    expect((await replay("unkeyed", wrapper)).status).toBe("completed");

    // The action runs as the wrapper's child, so its row has none.
    expect(rows()).toEqual([["unkeyed", null, null]]);
  });

  it.each(["defineAction", "raw"])(
    "does not reach a %s child a raw entry's code bridge runs",
    async (kind) => {
      const read = async (_args: unknown, ctx?: ActionRunContext) => {
        if (kind === "raw") await selfAudit("read-sensitive", ctx);
        return "read";
      };
      const child =
        kind === "raw"
          ? {
              tool: { description: "Read", parameters: { type: "object" } },
              readOnly: true,
              run: read,
            }
          : defineAction({
              description: "Read sensitive data",
              schema: z.object({}),
              readOnly: true,
              http: { method: "GET" },
              audit: { onRead: true },
              run: read,
            });
      const runCode = {
        ...createRunCodeEntry(
          () => ({ "read-sensitive": child as ActionEntry }),
          { evaluator: "run" },
        ),
        needsApproval: true,
      };

      const result = await replay("run-code", runCode, {
        code: 'console.log(await appAction("read-sensitive", {}));',
      });

      expect(result.status).toBe("completed");
      expect(rows()).toEqual([["read-sensitive", null, null]]);
      expect(recorded[0]).toMatchObject(noReplayIds);
    },
  );

  it("gives a replay inside an approved action its own, then the outer's again", async () => {
    const inner = approvalGated(async () => "inner");
    const outer = approvalGated(async (_args, ctx) => {
      expect((await replay("inner", inner, {}, "inner-task")).status).toBe(
        "completed",
      );
      await selfAudit("outer-body", ctx);
      return "outer";
    });

    expect((await replay("outer", outer, {}, "outer-task")).status).toBe(
      "completed",
    );

    expect(rows()).toEqual([
      ["inner", "inner-task", "a2a-review"],
      ["outer-body", "outer-task", "a2a-review"],
      ["outer", "outer-task", "a2a-review"],
    ]);
  });

  it("does not reach the row of a call a loop inside the approved action pauses", async () => {
    const gated = approvalGated(async () => "never runs");
    const outer = approvalGated(async () => {
      const paused = await executeAgentToolCall({
        actions: { gated: gated as ActionEntry },
        name: "gated",
        input: {},
        callId: "call-gated",
        ownerEmail: OWNER,
        orgId: "org-1",
      });
      return paused.status;
    });

    const result = await replay("outer", outer);

    expect(result).toMatchObject({ status: "completed" });
    expect(rows()).toEqual([
      ["gated", null, null],
      ["outer", TASK, "a2a-review"],
    ]);
    expect(recorded[0]).toMatchObject({ status: "denied", ...noReplayIds });
  });

  it("keeps concurrent replays of one action apart", async () => {
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = approvalGated(async (_args, ctx) => {
      entered += 1;
      if (entered === 2) release();
      await bothEntered;
      await selfAudit("self-audited", ctx);
      return "changed";
    });

    const results = await Promise.all([
      replay("concurrent", action, {}, "task-a"),
      replay("concurrent", action, {}, "task-b"),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(recorded.map((row) => row.threadId).sort()).toEqual([
      "task-a",
      "task-a",
      "task-b",
      "task-b",
    ]);
  });

  it("is never read from a run context, so no input can set one", async () => {
    expectTypeOf<ActionRunContext>().not.toHaveProperty("auditOverride");
    expectTypeOf<ActionRunContext>().not.toHaveProperty("mcpClientAccepted");
    const action = defineAction({
      description: "Change",
      schema: z.object({}),
      run: async () => "changed",
    });

    await action.run(
      {},
      {
        caller: "tool",
        userEmail: OWNER,
        orgId: "org-1",
        actionName: "change",
        approvedToolCallKey: toolCallCacheKey("change", {}),
        // @ts-expect-error An override is held by one invocation's frame, not its context.
        auditOverride: { ...replayIds, approval: "a2a-review" },
      },
    );

    expect(rows()).toEqual([["change", null, null]]);
    expect(recorded[0]).toMatchObject(noReplayIds);
  });
});

describe("an invocation's approval", () => {
  function parentWithChild(seen: unknown[]) {
    const child = defineAction({
      description: "Child",
      schema: z.object({}),
      run: async () => "child done",
    });
    return approvalGated(async (_args, ctx) => {
      seen.push(ctx?.approvedToolCallKey);
      return child.run({}, { ...ctx!, actionName: "child" });
    });
  }

  it("in agent chat is recorded by the approved action, not by a child it calls", async () => {
    const seen: unknown[] = [];
    const approvalKey = toolCallCacheKey("parent", {});

    const result = await executeAgentToolCall({
      actions: { parent: parentWithChild(seen) as ActionEntry },
      name: "parent",
      input: {},
      callId: "call-chat",
      ownerEmail: OWNER,
      orgId: "org-1",
      approvedToolCalls: [approvalKey],
    });

    expect(result.status).toBe("completed");
    // Approval gates read the key from the approved call's context.
    expect(seen).toEqual([approvalKey]);
    expect(rows()).toEqual([
      ["child", null, null],
      ["parent", null, "agent-chat"],
    ]);
  });

  it("an MCP client accepted is recorded by the accepted action, not by a child it calls", async () => {
    await runActionInvocation(
      parentWithChild([]),
      {},
      { ...mcpCall, actionName: "parent" },
      { mcpClientAccepted: true },
    );

    expect(rows()).toEqual([
      ["child", null, null],
      ["parent", null, "mcp-client-accepted"],
    ]);
    expect(recorded[0]).toMatchObject({
      caller: "mcp",
      reportedClientName: "Example Client",
    });
  });
});
