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

const { default: manageProviderKeyPolicy } =
  await import("../agent/actions/manage-provider-key-policy.js");
const { default: manageServiceProviders } =
  await import("../agent/actions/manage-service-providers.js");
const { recordOrgAdminAuditEvent } = await import("./org-admin.js");
const { auditAttribution, routeAuditAttribution } =
  await import("./attribution.js");
const { markVerifiedMcpCredentialForEvent } =
  await import("../server/request-context.js");
const { defineAction } = await import("../action.js");
const { toolCallCacheKey } = await import("../agent/production-agent.js");
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
  mcpClientAccepted: true as const,
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
    await manageProviderKeyPolicy.run(
      { set: true },
      { ...mcpCall, actionName: "manage-provider-key-policy" },
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
    await manageServiceProviders.run(
      { service: "voice", provider: "gemini" },
      { ...mcpCall, actionName: "manage-service-providers" },
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

function replay(name: string, entry: unknown, input: object = {}) {
  return executeApprovedA2AToolCall(
    {
      id: "approval-review",
      taskId: TASK,
      ownerEmail: OWNER,
      orgId: "org-1",
      tool: name,
      input,
      approvalKey: toolCallCacheKey(name, input),
      callId: "call-review",
    },
    { actions: { [name]: entry as ActionEntry } },
  );
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

  it("reaches the row an approval-gated action records itself", async () => {
    const action = defineAction({
      description: "Change a setting",
      schema: z.object({}),
      needsApproval: true,
      audit: { enabled: false },
      run: async (_args, ctx) => {
        await recordOrgAdminAuditEvent({
          action: "self-audited",
          targetType: "setting",
          summary: "Changed a setting",
          userEmail: ctx?.userEmail,
          orgId: ctx?.orgId,
          attribution: auditAttribution(ctx),
        });
        return "changed";
      },
    });

    expect((await replay("self-audited", action)).status).toBe("completed");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "self-audited",
      ...replayIds,
      approval: "a2a-review",
    });
  });

  it("reaches the approved action's own row, not a child given a copy of its context", async () => {
    const child = defineAction({
      description: "Child",
      schema: z.object({}),
      run: async () => "child done",
    });
    const parent = defineAction({
      description: "Parent",
      schema: z.object({}),
      needsApproval: true,
      run: async (_args, ctx) =>
        child.run({}, { ...ctx!, actionName: "child" }),
    });

    expect((await replay("parent", parent)).status).toBe("completed");

    expect(recorded.map((row) => row.action)).toEqual(["child", "parent"]);
    expect(recorded[0]).toMatchObject(noReplayIds);
    expect(recorded[0]!.approval).not.toBe("a2a-review");
    expect(recorded[1]).toMatchObject({
      ...replayIds,
      approval: "a2a-review",
    });
  });

  it.each(["defineAction", "raw"])(
    "does not reach a child called with the %s parent's own context object",
    async (kind) => {
      const seen: unknown[] = [];
      const child = defineAction({
        description: "Child",
        schema: z.object({}),
        run: async (_args, ctx) => {
          const { threadId, approval } = auditAttribution(ctx);
          seen.push({ threadId, approval });
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
          : defineAction({
              description: "Parent",
              schema: z.object({}),
              needsApproval: true,
              run,
            });

      expect((await replay("parent", parent)).status).toBe("completed");

      expect(seen).toEqual([{ threadId: undefined, approval: undefined }]);
      // The child's row comes first; only a defineAction parent writes one.
      expect(recorded).toHaveLength(kind === "raw" ? 1 : 2);
      expect(recorded[0]).toMatchObject(noReplayIds);
      expect(recorded[0]!.approval).not.toBe("a2a-review");
      expect(recorded.slice(1)).toMatchObject(
        kind === "raw" ? [] : [{ ...replayIds, approval: "a2a-review" }],
      );
    },
  );

  it("does not reach a child a raw entry's code bridge runs", async () => {
    const child = defineAction({
      description: "Read sensitive data",
      schema: z.object({}),
      readOnly: true,
      http: { method: "GET" },
      audit: { onRead: true },
      run: async () => "read",
    });
    const runCode = {
      ...createRunCodeEntry(
        () => ({ "read-sensitive": child as ActionEntry }),
        {
          evaluator: "run",
        },
      ),
      needsApproval: true,
    };

    const result = await replay("run-code", runCode, {
      code: 'console.log(await appAction("read-sensitive", {}));',
    });

    expect(result.status).toBe("completed");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "read-sensitive",
      ...noReplayIds,
    });
    expect(recorded[0]!.approval).not.toBe("a2a-review");
  });

  it("is never read from a run context, so no input can set one", async () => {
    expectTypeOf<ActionRunContext>().not.toHaveProperty("auditOverride");
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
        // @ts-expect-error An override is bound to one invocation, not carried on its context.
        auditOverride: { ...replayIds, approval: "a2a-review" },
      },
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: "change",
      ...noReplayIds,
      approval: null,
    });
  });
});
