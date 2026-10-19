import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  canonicalJson,
  executeMcpActionCall,
  sha256Base64Url,
} from "../mcp/execute-action-call.js";
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
const evaluateServicePrincipal = vi.hoisted(() => vi.fn());
vi.mock("../org/service-principal-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: (...args: unknown[]) =>
    evaluateServicePrincipal(...args),
  lockServicePrincipalLifecycle: async () => undefined,
}));
// Run admission's transaction, with no database behind it.
const fakeDb = vi.hoisted(() => {
  const db = {
    execute: async () => ({ rows: [], rowsAffected: 1 }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return db;
});
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => fakeDb,
}));
vi.mock("../db/store-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../db/store-registry.js")>();
  return {
    ...actual,
    defineStore: ((input) => ({
      ...actual.defineStore(input),
      ready: async () => undefined,
    })) as typeof actual.defineStore,
  };
});
// An MCP approval the client accepted, consumed once.
vi.mock("../mcp/approval-store.js", () => ({
  createMcpApprovalGrant: async () => undefined,
  consumeMcpApprovalGrant: async () => true,
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
const { markVerifiedMcpCredentialForEvent, runWithRequestContext } =
  await import("../server/request-context.js");
const { ACTION_EXECUTION_KEY, actionCallIntent, defineAction } =
  await import("../action.js");
const { approvalKeyWithArguments } = await import("../agent/approval-key.js");
const { runActionInvocation } = await import("../action-invocation.js");
const { executeAgentToolCall, toolCallCacheKey } =
  await import("../agent/production-agent.js");
const { _agentTeamsQueueForTests } = await import("../server/agent-teams.js");
const { createRunCodeEntry } = await import("../coding-tools/run-code.js");
const { executeApprovedA2AToolCall } =
  await import("../server/agent-chat/action-filters-a2a.js");
const { a2aTaskLeaseThreadId } = await import("../a2a/task-store.js");
const { insertRun, tryClaimRunSlot } = await import("../agent/run-store.js");
const { noteJobFrontmatterWrite } = await import("../jobs/frontmatter-loss.js");

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

/** The fingerprint of the arguments `entry` runs `args` with, defaults applied. */
async function preparedHash(entry: unknown, args: object) {
  const prepared = await actionCallIntent(entry as ActionEntry, args);
  if (!prepared.valid) throw prepared.error;
  return prepared.argumentsHash;
}

/** Runs `name` through the MCP tool-call core, resumed with an accepted approval. */
async function mcpAccepted(name: string, entry: unknown, args: object) {
  const approval = {
    version: 1 as const,
    nonce: `nonce-${name}`,
    actionName: name,
    argumentsHash: await sha256Base64Url(
      `${canonicalJson(args)}
${await preparedHash(entry, args)}`,
    ),
    expiresAt: Date.now() + 60_000,
  };
  const outcome = await runWithRequestContext(
    { userEmail: OWNER, orgId: "org-1" },
    () =>
      executeMcpActionCall(
        {
          appId: undefined,
          identity: {
            userEmail: OWNER,
            identityAssurance: "user",
            orgDomain: undefined,
          },
          approvalCallerKey: "caller-key",
          canRequestApproval: true,
        },
        {
          name,
          args,
          callable: { [name]: entry as ActionEntry },
          actionRunContext: { mcpClient: mcpCall.mcpClient },
          approval: { state: () => approval, decision: () => "approve" },
        },
      ),
  );
  expect(outcome.status).toBe("completed");
}

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
  evaluateServicePrincipal.mockResolvedValue({ status: "not-service" });
});

describe("admin writes recorded outside the action's own audit", () => {
  it("keep the MCP client, OAuth client and approval of a provider key policy change", async () => {
    await mcpAccepted("manage-provider-key-policy", manageProviderKeyPolicy, {
      set: true,
    });

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
    await mcpAccepted("manage-service-providers", manageServiceProviders, {
      service: "voice",
      provider: "gemini",
    });

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
// A call the replay's context reaches, other than the approved one, records the
// approval route's execution lease it runs under, never the override.
const leaseIds = {
  ...noReplayIds,
  threadId: a2aTaskLeaseThreadId(TASK),
  turnId: TASK,
};

async function replay(
  name: string,
  entry: unknown,
  input: object = {},
  task = TASK,
  ownerEmail = OWNER,
) {
  return executeApprovedA2AToolCall(
    {
      id: `approval-${task}`,
      taskId: task,
      ownerEmail,
      orgId: "org-1",
      tool: name,
      input,
      // A paused A2A task stores the key bound to the arguments it approved.
      approvalKey: approvalKeyWithArguments(
        toolCallCacheKey(name, input),
        await preparedHash(entry, input),
      ),
      callId: `call-${task}`,
    },
    {
      actions: { [name]: entry as ActionEntry },
      // As the approval route does: under the task's execution lease.
      signal: new AbortController().signal,
      threadId: a2aTaskLeaseThreadId(task),
      turnId: task,
    },
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
      ["child", leaseIds.threadId, null],
      ["parent", TASK, "a2a-review"],
    ]);
    expect(recorded[0]).toMatchObject(leaseIds);
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
          threadId: leaseIds.threadId,
          approval: undefined,
          approvedToolCallKey: undefined,
        },
      ]);
      // The child's row comes first; only a defineAction parent writes one.
      expect(rows()).toEqual(
        kind === "raw"
          ? [["parent", leaseIds.threadId, null]]
          : [
              ["parent", leaseIds.threadId, null],
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
      ["self-audited", leaseIds.threadId, null],
      ["recursive", leaseIds.threadId, null],
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

    expect(rows()).toEqual([["kept", leaseIds.threadId, null]]);
    expect(recorded[0]).toMatchObject(leaseIds);
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
    expect(rows()).toEqual([["unkeyed", leaseIds.threadId, null]]);
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
      expect(rows()).toEqual([["read-sensitive", leaseIds.threadId, null]]);
      expect(recorded[0]).toMatchObject(leaseIds);
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
    const parent = parentWithChild(seen);

    const result = await executeAgentToolCall({
      actions: { parent: parent as ActionEntry },
      name: "parent",
      input: {},
      callId: "call-chat",
      ownerEmail: OWNER,
      orgId: "org-1",
      approvedToolCalls: [
        approvalKeyWithArguments(approvalKey, await preparedHash(parent, {})),
      ],
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
    await mcpAccepted("parent", parentWithChild([]), {});

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

describe("a refusal of another call", () => {
  const SERVICE = "svc-bot@service.org-1";
  const serviceCall = (actionName: string) => ({
    userEmail: SERVICE,
    orgId: "org-1",
    caller: "mcp" as const,
    actionName,
  });
  const a2aReview = {
    auditOverride: { ...replayIds, approval: "a2a-review" as const },
  };
  const refused = defineAction({
    description: "Read something the grant leaves out",
    schema: z.object({}),
    readOnly: true,
    run: async () => "never runs",
  });

  function allow(...allowedActions: string[]) {
    evaluateServicePrincipal.mockResolvedValue({
      status: "active",
      policy: { lifecycle: "active", allowedActions },
    });
  }

  function refusals() {
    return recorded
      .filter((row) => row.targetType === "service-principal")
      .map((row) => [row.action, row.threadId, row.approval]);
  }

  const runCode = {
    ...createRunCodeEntry(() => ({ refused: refused as ActionEntry }), {
      evaluator: "run",
    }),
    needsApproval: true,
  };
  const code = 'try { await appAction("refused", {}); } catch {}';

  function loopInside() {
    return approvalGated(async () => {
      const outcome = await executeAgentToolCall({
        actions: { refused: refused as ActionEntry },
        name: "refused",
        input: {},
        callId: "call-refused",
        ownerEmail: SERVICE,
        orgId: "org-1",
      });
      return outcome.status;
    });
  }

  it("does not carry an accepted MCP call's approval to a child its code bridge refuses", async () => {
    allow("run-code");
    await runActionInvocation(runCode, { code }, serviceCall("run-code"), {
      mcpClientAccepted: true,
    });

    expect(refusals()).toEqual([["refused", null, null]]);
  });

  it("does not carry an A2A review to a child its code bridge refuses", async () => {
    allow("run-code");
    const result = await replay("run-code", runCode, { code }, TASK, SERVICE);

    expect(result.status).toBe("completed");
    expect(refusals()).toEqual([["refused", null, null]]);
  });

  it("does not carry an accepted MCP call's approval to a call its agent loop refuses", async () => {
    allow("outer");
    await runActionInvocation(loopInside(), {}, serviceCall("outer"), {
      mcpClientAccepted: true,
    });

    expect(refusals()).toEqual([["refused", null, null]]);
    expect(rows()).toContainEqual(["outer", null, "mcp-client-accepted"]);
  });

  it("does not carry an A2A review to a call its agent loop refuses", async () => {
    allow("outer");
    const result = await replay("outer", loopInside(), {}, TASK, SERVICE);

    expect(result.status).toBe("completed");
    expect(refusals()).toEqual([["refused", null, null]]);
    expect(rows()).toContainEqual(["outer", TASK, "a2a-review"]);
  });

  it("does not carry an approval to a call the MCP tool-call core refuses inside it", async () => {
    allow("outer");
    const outer = approvalGated(() =>
      runWithRequestContext({ userEmail: SERVICE, orgId: "org-1" }, () =>
        executeMcpActionCall(
          {
            appId: undefined,
            identity: {
              userEmail: SERVICE,
              identityAssurance: "service",
              orgDomain: undefined,
            },
            approvalCallerKey: undefined,
            canRequestApproval: false,
          },
          {
            name: "refused",
            args: {},
            callable: { refused: refused as ActionEntry },
          },
        ),
      ),
    );
    await runActionInvocation(outer, {}, serviceCall("outer"), {
      mcpClientAccepted: true,
    });

    expect(refusals()).toEqual([["refused", null, null]]);
  });

  it.each(["tryClaimRunSlot", "insertRun"] as const)(
    "does not carry an A2A review to a run %s refuses to admit inside it",
    async (admit) => {
      evaluateServicePrincipal.mockImplementation(async (email: string) =>
        email === SERVICE ? { status: "suspended" } : { status: "not-service" },
      );
      const turnInitiator = {
        email: SERVICE,
        orgId: "org-1",
        anonymous: false,
      };
      const outer = approvalGated(async () => {
        await expect(
          admit === "tryClaimRunSlot"
            ? tryClaimRunSlot("thread-2", "run-2", undefined, { turnInitiator })
            : insertRun("run-2", "thread-2", undefined, { turnInitiator }),
        ).rejects.toMatchObject({ errorCode: "service_principal_inactive" });
        return "done";
      });
      const result = await replay("outer", outer);

      expect(result.status).toBe("completed");
      expect(refusals()).toEqual([["agent-run:start", null, null]]);
      expect(recorded[0]).toMatchObject(noReplayIds);
    },
  );

  it.each([
    [
      "an accepted MCP call",
      { mcpClientAccepted: true as const },
      null,
      "mcp-client-accepted",
    ],
    ["an A2A review", a2aReview, TASK, "a2a-review"],
  ])(
    "keeps %s on the refusal of the approved call itself",
    async (_label, evidence, threadId, approval) => {
      allow("something-else");
      await expect(
        runActionInvocation(refused, {}, serviceCall("refused"), evidence),
      ).rejects.toThrow();

      expect(refusals()).toEqual([["refused", threadId, approval]]);
    },
  );
});

describe("a call declined for invalid arguments inside an approved action", () => {
  const rename = defineAction({
    description: "Rename the draft",
    schema: z.object({ title: z.string() }),
    run: async () => "renamed",
  });

  it.each([
    [
      "its agent loop",
      () =>
        executeAgentToolCall({
          actions: { rename: rename as ActionEntry },
          name: "rename",
          input: {},
          callId: "call-rename",
          ownerEmail: OWNER,
          orgId: "org-1",
        }),
      { caller: "tool" },
    ],
    [
      "the MCP tool-call core",
      () =>
        runWithRequestContext({ userEmail: OWNER, orgId: "org-1" }, () =>
          executeMcpActionCall(
            {
              appId: undefined,
              identity: {
                userEmail: OWNER,
                identityAssurance: "user",
                orgDomain: undefined,
              },
              approvalCallerKey: undefined,
              canRequestApproval: false,
            },
            {
              name: "rename",
              args: {},
              callable: { rename: rename as ActionEntry },
              actionRunContext: { mcpClient: mcpCall.mcpClient },
            },
          ),
        ),
      {
        caller: "mcp",
        reportedClientName: "Example Client",
        oauthClientId: "example-oauth-client",
      },
    ],
  ])(
    "keeps its own source and gets none of its A2A review from %s",
    async (_label, decline, source) => {
      const outer = approvalGated(async () => {
        await decline();
        return "done";
      });

      expect((await replay("outer", outer)).status).toBe("completed");

      expect(rows()).toEqual([
        ["rename", null, null],
        ["outer", TASK, "a2a-review"],
      ]);
      expect(recorded[0]).toMatchObject({
        status: "error",
        ...source,
        ...noReplayIds,
      });
    },
  );
});

describe("an invocation that has settled", () => {
  /** An approved call that starts `write` and returns before it runs. */
  function leavingWork(write: () => unknown) {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    let later!: Promise<unknown>;
    const entry = approvalGated(async () => {
      later = new Promise((resolve) => setTimeout(resolve, 0))
        .then(() => settled)
        .then(write);
      return "done";
    });
    return {
      entry,
      afterSettle: () => {
        settle();
        return later;
      },
    };
  }

  it("gives none of its A2A review to a timer it left running", async () => {
    const { entry, afterSettle } = leavingWork(() =>
      selfAudit("later", { userEmail: OWNER, orgId: "org-1", caller: "tool" }),
    );
    expect((await replay("outer", entry)).status).toBe("completed");
    await afterSettle();

    expect(rows()).toEqual([
      ["outer", TASK, "a2a-review"],
      ["later", null, null],
    ]);
    expect(recorded[1]).toMatchObject(noReplayIds);
  });

  it("gives none of its A2A review to a recurring job's write it left running", async () => {
    const { entry, afterSettle } = leavingWork(() =>
      runWithRequestContext({ userEmail: OWNER, orgId: "org-1" }, () =>
        noteJobFrontmatterWrite({
          owner: OWNER,
          orgId: "org-1",
          path: "jobs/review.md",
          writer: "resourcePut",
          before:
            '---\nschedule: "*/5 * * * *"\nenabled: true\nsource: slack\n---\nBody',
          after: '---\nschedule: "*/5 * * * *"\nenabled: true\n---\nBody',
        }),
      ),
    );
    expect((await replay("outer", entry)).status).toBe("completed");
    await afterSettle();

    expect(rows()).toEqual([
      ["outer", TASK, "a2a-review"],
      ["job-fields-dropped", null, null],
    ]);
  });

  it("keeps its A2A review on a write it awaits as its last step", async () => {
    const entry = approvalGated(async (_args, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await selfAudit("last", ctx);
      return "done";
    });
    expect((await replay("outer", entry)).status).toBe("completed");

    expect(rows()).toEqual([
      ["last", TASK, "a2a-review"],
      ["outer", TASK, "a2a-review"],
    ]);
  });
});
