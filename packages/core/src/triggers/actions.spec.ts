import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  createMcpApprovalGrant: vi.fn(),
  consumeMcpApprovalGrant: vi.fn(),
  defineAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  getUserSetting: vi.fn(),
  listAccessibleAutomationDefinitions: vi.fn(),
  queueAutomationRunNow: vi.fn(),
  refreshEventSubscriptions: vi.fn(),
  updateAutomation: vi.fn(),
}));

vi.mock("../automations/service.js", () => ({
  defineAutomation: mocks.defineAutomation,
  deleteAutomation: mocks.deleteAutomation,
  listAccessibleAutomationDefinitions:
    mocks.listAccessibleAutomationDefinitions,
  updateAutomation: mocks.updateAutomation,
}));
vi.mock("../jobs/run-now.js", () => ({
  queueAutomationRunNow: mocks.queueAutomationRunNow,
}));
vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: mocks.getUserSetting,
}));
vi.mock("./dispatcher.js", () => ({
  refreshEventSubscriptions: mocks.refreshEventSubscriptions,
}));
vi.mock("../integrations/remote-devices-store.js", () => ({
  listRemoteDevicesForOwner: vi.fn(async () => []),
  getRemoteExecutionCapabilities: vi.fn(),
}));
vi.mock("../event-bus/index.js", () => ({
  listEvents: () => [],
  emit: vi.fn(),
}));
vi.mock("../server/request-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/request-context.js")>()),
  getRequestUserEmail: () => "alice@example.com",
  getIntegrationRequestContext: () => undefined,
  getRequestOrgId: () => "org-1",
}));

vi.mock("../mcp/approval-store.js", () => ({
  createMcpApprovalGrant: mocks.createMcpApprovalGrant,
  consumeMcpApprovalGrant: mocks.consumeMcpApprovalGrant,
}));

import {
  defineAction,
  type ActionCaller,
  type ActionRunContext,
} from "../action.js";
import { executeAgentToolCall } from "../agent/production-agent.js";
import runAutomationNow from "../jobs/actions/run-automation-now.js";
import { executeMcpActionCall } from "../mcp/execute-action-call.js";
import { directHttpActionApprovalRefusal } from "../server/action-approval.js";
import { createAutomationToolEntries } from "./actions.js";
import manageAutomation from "./actions/manage-automation.js";

const owner = "alice@example.com";
const definition = {
  resource: {
    id: "resource-1",
    owner,
    path: "jobs/digest.md",
    content: "content",
  },
  resourceId: "resource-1",
  name: "digest",
  scope: "personal",
  classification: {
    kind: "automation",
    triggerType: "manual",
    hasExplicitTriggerType: true,
  },
  meta: {
    schedule: "",
    enabled: true,
    triggerType: "manual",
    mode: "agentic",
    createdBy: owner,
    runAs: "creator",
  },
  body: "Build the digest.",
  canUpdate: true,
  effectiveRole: "owner",
  capabilities: {
    canEdit: true,
    canOperate: true,
    canDelete: true,
    canManageSharing: true,
  },
  sharing: {
    source: "explicit",
    visibility: "private",
    organizationId: null,
    grantCount: 1,
    grants: [
      {
        email: "viewer@example.com",
        role: "view",
        name: "Viewer",
        avatar: "https://example.com/viewer.png",
      },
    ],
  },
  creator: { email: owner, label: "Alice" },
};

function tool() {
  return createAutomationToolEntries(() => owner)["manage-automations"];
}

describe("manage-automations tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.listAccessibleAutomationDefinitions.mockResolvedValue([definition]);
    mocks.defineAutomation.mockResolvedValue(definition);
    mocks.updateAutomation.mockResolvedValue(definition);
    mocks.deleteAutomation.mockResolvedValue(undefined);
    mocks.queueAutomationRunNow.mockResolvedValue({
      queued: true,
      runId: "run-1",
      automationRunId: "run-1",
    });
  });

  it("preserves plan-mode reads and confirmations for writes", () => {
    const effect = tool().planMode?.effect;
    if (typeof effect !== "function") throw new Error("Missing classifier");
    expect(effect({ action: "list" })).toBe("read");
    expect(effect({ action: "list-events" })).toBe("read");
    expect(effect({ action: "define" })).toBe("write");
    expect(effect({ action: "delete" })).toBe("write");
  });

  it("lists unified access, sharing, classification, and stable ids", async () => {
    const result = JSON.parse(await tool().run({ action: "list" }));
    expect(result).toEqual([
      expect.objectContaining({
        resourceId: "resource-1",
        classification: "automation",
        effectiveRole: "owner",
        capabilities: definition.capabilities,
        sharing: definition.sharing,
      }),
    ]);
    expect(mocks.listAccessibleAutomationDefinitions).toHaveBeenCalledWith({
      userEmail: owner,
      orgId: "org-1",
    });
  });

  it("forwards complete sharing and external acknowledgement on define/update", async () => {
    const sharing = {
      kind: "specific",
      organizationId: "org-1",
      grants: [{ email: "outside@example.com", role: "collaborate" }],
    };
    await tool().run({
      action: "define",
      name: "digest",
      trigger_type: "manual",
      body: "Build it.",
      sharing,
      acknowledge_external_collaborators: "true",
    });
    expect(mocks.defineAutomation).toHaveBeenCalledWith(
      { userEmail: owner, orgId: "org-1" },
      expect.objectContaining({
        sharing,
        acknowledgeExternalCollaborators: true,
      }),
    );

    await tool().run({
      action: "update",
      resource_id: "resource-1",
      sharing: { kind: "personal" },
    });
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      { userEmail: owner, orgId: "org-1" },
      expect.objectContaining({
        resourceId: "resource-1",
        sharing: { kind: "personal" },
      }),
    );
  });

  it("keeps name/scope compatibility while preferring resource ids", async () => {
    await tool().run({
      action: "update",
      name: "digest",
      scope: "personal",
      enabled: "false",
    });
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "digest", scope: "personal" }),
    );

    await tool().run({ action: "delete", resource_id: "resource-1" });
    expect(mocks.deleteAutomation).toHaveBeenCalledWith(expect.anything(), {
      resourceId: "resource-1",
    });
  });

  it("rejects public sharing and throws failures instead of returning Error strings", async () => {
    await expect(
      tool().run({
        action: "define",
        name: "public-digest",
        trigger_type: "manual",
        body: "Build it.",
        sharing: { kind: "public" },
      }),
    ).rejects.toThrow(/sharing kind/);
    await expect(
      tool().run({
        action: "define",
        name: "deterministic",
        trigger_type: "manual",
        body: "Build it.",
        mode: "deterministic",
      }),
    ).rejects.toThrow(/Deterministic mode was removed/);
  });

  it("queues resource-id runs and describes immutable creator execution", async () => {
    const entry = tool();
    expect(entry.tool.description).toContain("immutable creator");
    expect(entry.tool.parameters?.properties.resource_id).toBeDefined();
    await entry.run({ action: "run-now", resource_id: "resource-1" });
    expect(mocks.queueAutomationRunNow).toHaveBeenCalledWith({
      userEmail: owner,
      orgId: "org-1",
      resourceId: "resource-1",
      scope: undefined,
      name: undefined,
    });
    for (const context of [
      { caller: "automation" as const },
      {
        caller: "mcp" as const,
        automation: { triggerId: "parent", triggerName: "parent" },
      },
    ]) {
      await expect(
        entry.run({ action: "run-now", resource_id: "resource-1" }, context),
      ).rejects.toThrow(/cannot run another automation/);
    }
  });

  it.each([
    { caller: "automation" as const },
    {
      caller: "mcp" as const,
      automation: { triggerId: "parent", triggerName: "parent" },
    },
  ])("refuses fire-test chaining from $caller", async (context) => {
    const { emit } = await import("../event-bus/index.js");
    await expect(
      tool().run({ action: "fire-test", data: '{"test":true}' }, context),
    ).rejects.toThrow(/cannot run another automation/);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each(["fire-test", "run-now", "run-automation-now"])(
    "localizes the %s chaining refusal for the caller",
    async (action) => {
      const { emit } = await import("../event-bus/index.js");
      mocks.getUserSetting.mockResolvedValueOnce({ locale: "es-ES" });
      const context = {
        userEmail: owner,
        caller: "mcp" as const,
        automation: { triggerId: "parent", triggerName: "parent" },
      };
      await expect(
        action === "run-automation-now"
          ? runAutomationNow.run({ resourceId: "resource-1" }, context)
          : tool().run({ action, resource_id: "resource-1" }, context),
      ).rejects.toThrow(
        "Una automatización no puede ejecutar otra automatización.",
      );
      expect(mocks.getUserSetting).toHaveBeenCalledWith(owner, "localization");
      expect(emit).not.toHaveBeenCalled();
      expect(mocks.queueAutomationRunNow).not.toHaveBeenCalled();
    },
  );
});

describe("MCP automation approval", () => {
  afterEach(() => vi.restoreAllMocks());
  const mutations = [
    {
      name: "manage-automations",
      args: {
        action: "define",
        name: "digest",
        trigger_type: "manual",
        body: "Build it.",
      },
    },
    {
      name: "manage-automations",
      args: { action: "update", resource_id: "resource-1", body: "Change it." },
    },
    {
      name: "manage-automations",
      args: { action: "delete", resource_id: "resource-1" },
    },
    { name: "manage-automations", args: { action: "fire-test" } },
    {
      name: "manage-automations",
      args: { action: "run-now", resource_id: "resource-1" },
    },
    {
      name: "manage-automation",
      args: {
        operation: "create",
        name: "digest",
        triggerType: "manual",
        body: "Build it.",
      },
    },
    {
      name: "manage-automation",
      args: {
        operation: "update",
        resourceId: "resource-1",
        body: "Change it.",
      },
    },
    {
      name: "manage-automation",
      args: { operation: "delete", resourceId: "resource-1" },
    },
    { name: "run-automation-now", args: { resourceId: "resource-1" } },
  ];
  const context = {
    appId: undefined,
    identity: {
      userEmail: owner,
      identityAssurance: "user" as const,
      orgDomain: undefined,
    },
    approvalCallerKey: "automation-spec-client",
    canRequestApproval: true,
  };
  function callable() {
    return {
      "manage-automations": tool(),
      "manage-automation": manageAutomation,
      "run-automation-now": runAutomationNow,
    };
  }

  type Origin = Pick<ActionRunContext, "caller" | "networkProtocol">;

  function nestedCall<T>(
    run: () => Promise<T>,
    origin: ActionCaller | Origin = "mcp",
  ) {
    const inner = defineAction({
      description: "Dispatch an automation operation.",
      schema: z.object({}),
      run,
    });
    const outer = defineAction({
      description: "Delegate an automation operation.",
      schema: z.object({}),
      run: () => inner.run({}, { caller: "tool", userEmail: owner }),
    });
    return outer.run(
      {},
      {
        ...(typeof origin === "string" ? { caller: origin } : origin),
        userEmail: owner,
      },
    );
  }

  function dispatch(
    args: Record<string, unknown>,
    approvedToolCalls?: string[],
    origin: Origin = { caller: "tool" },
  ) {
    return executeAgentToolCall({
      actions: callable(),
      name: "manage-automations",
      input: args,
      callId: "nested-automation-call",
      caller: origin.caller,
      networkProtocol: origin.networkProtocol,
      ownerEmail: owner,
      orgId: "org-1",
      approvedToolCalls,
      consumeApproval: async () => true,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeMcpApprovalGrant.mockResolvedValue(true);
    mocks.listAccessibleAutomationDefinitions.mockResolvedValue([definition]);
    mocks.defineAutomation.mockResolvedValue(definition);
    mocks.updateAutomation.mockResolvedValue(definition);
    mocks.queueAutomationRunNow.mockResolvedValue({
      queued: true,
      runId: "run-1",
    });
  });

  it.each(mutations)(
    "does not run $name $args without approval or after denial",
    async ({ name, args }) => {
      const entries = callable();
      const run = vi.spyOn(entries[name as keyof typeof entries], "run");
      const first = await executeMcpActionCall(context, {
        name,
        args,
        callable: entries,
      });
      expect(first.status).toBe("approval-required");
      expect(run).not.toHaveBeenCalled();
      const grant = mocks.createMcpApprovalGrant.mock.calls[0][0];
      const denied = await executeMcpActionCall(context, {
        name,
        args,
        callable: entries,
        approval: { state: () => grant, decision: () => "decline" },
      });
      expect(denied.status).toBe("approval-denied");
      expect(run).not.toHaveBeenCalled();
      expect(mocks.defineAutomation).not.toHaveBeenCalled();
      expect(mocks.updateAutomation).not.toHaveBeenCalled();
      expect(mocks.deleteAutomation).not.toHaveBeenCalled();
      expect(mocks.queueAutomationRunNow).not.toHaveBeenCalled();
      run.mockRestore();
    },
  );

  describe.each<{ label: string; outer?: Origin; inner?: Origin }>([
    { label: "nested MCP caller", outer: { caller: "mcp" } },
    { label: "nested A2A caller", outer: { caller: "a2a" } },
    {
      label: "nested tool over A2A",
      outer: { caller: "tool", networkProtocol: "a2a" },
    },
    { label: "direct A2A caller", inner: { caller: "a2a" } },
    {
      label: "direct tool over A2A",
      inner: { caller: "tool", networkProtocol: "a2a" },
    },
  ])(
    "outside-agent origin: $label",
    ({ outer, inner = { caller: "tool" } }) => {
      const fromOrigin = <T>(run: (inner: Origin) => Promise<T>) =>
        outer ? nestedCall(() => run(inner), outer) : run(inner);

      it.each(mutations.filter(({ name }) => name === "manage-automations"))(
        "pauses $args before any automation side effect",
        async ({ args }) => {
          const { emit } = await import("../event-bus/index.js");
          const result = await fromOrigin((origin) =>
            dispatch(args, undefined, origin),
          );
          expect(result.status).toBe("approval_required");
          expect(mocks.defineAutomation).not.toHaveBeenCalled();
          expect(mocks.updateAutomation).not.toHaveBeenCalled();
          expect(mocks.deleteAutomation).not.toHaveBeenCalled();
          expect(mocks.queueAutomationRunNow).not.toHaveBeenCalled();
          expect(emit).not.toHaveBeenCalled();

          if (result.status !== "approval_required") {
            throw new Error("Missing approval request");
          }
          const approved = await fromOrigin((origin) =>
            dispatch(args, [result.approvalKey], origin),
          );
          expect(approved.status).toBe("completed");
          const effect =
            args.action === "define"
              ? mocks.defineAutomation
              : args.action === "update"
                ? mocks.updateAutomation
                : args.action === "delete"
                  ? mocks.deleteAutomation
                  : args.action === "run-now"
                    ? mocks.queueAutomationRunNow
                    : emit;
          expect(effect).toHaveBeenCalledOnce();
        },
      );

      it.each(mutations.filter(({ name }) => name !== "manage-automations"))(
        "requires approval for $name $args on the direct action surface",
        async ({ name, args }) => {
          const entry =
            callable()[name as "manage-automation" | "run-automation-now"];
          const refusal = await fromOrigin((origin) =>
            directHttpActionApprovalRefusal(entry, args, {
              ...origin,
              actionName: name,
              userEmail: owner,
            }),
          );
          expect(refusal).toMatchObject({
            errorCode: "approval_required",
            statusCode: 409,
          });
        },
      );

      it.each(["list", "list-events", "list-hosts"])(
        "runs %s without approval",
        async (action) => {
          const result = await fromOrigin((origin) =>
            dispatch({ action }, undefined, origin),
          );
          expect(result.status).toBe("completed");
          expect(mocks.createMcpApprovalGrant).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each(["tool", "frontend"] as const)(
    "preserves nested %s calls without an MCP ancestor",
    async (caller) => {
      const result = await nestedCall(
        () => dispatch(mutations[0].args),
        caller,
      );
      expect(result.status).toBe("completed");
      expect(mocks.defineAutomation).toHaveBeenCalledOnce();
      for (const { name, args } of mutations.filter(
        ({ name }) => name !== "manage-automations",
      )) {
        const entry =
          callable()[name as "manage-automation" | "run-automation-now"];
        await expect(
          nestedCall(
            () =>
              directHttpActionApprovalRefusal(entry, args, {
                actionName: name,
                caller: "tool",
                userEmail: owner,
              }),
            caller,
          ),
        ).resolves.toBeNull();
      }
    },
  );

  it.each(["list", "list-events", "list-hosts"])(
    "runs %s without approval",
    async (action) => {
      const entries = callable();
      const run = vi.spyOn(entries["manage-automations"], "run");
      const result = await executeMcpActionCall(context, {
        name: "manage-automations",
        args: { action },
        callable: entries,
      });
      expect(result.status).toBe("completed");
      expect(run).toHaveBeenCalledOnce();
      expect(mocks.createMcpApprovalGrant).not.toHaveBeenCalled();
      run.mockRestore();
    },
  );

  it("fires a test event only after direct MCP approval", async () => {
    const { emit } = await import("../event-bus/index.js");
    const entries = callable();
    const call = {
      name: "manage-automations",
      args: { action: "fire-test", data: '{"test":true}' },
      callable: entries,
    };
    await expect(executeMcpActionCall(context, call)).resolves.toMatchObject({
      status: "approval-required",
    });
    expect(emit).not.toHaveBeenCalled();
    const grant = mocks.createMcpApprovalGrant.mock.calls[0][0];
    await expect(
      executeMcpActionCall(context, {
        ...call,
        approval: { state: () => grant, decision: () => "approve" },
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "test.event.fired",
      { data: { test: true } },
      { owner },
    );
  });

  it.each([
    { name: "manage-automations", args: mutations[0].args },
    { name: "manage-automations", args: mutations[1].args },
    { name: "manage-automation", args: mutations[5].args },
    { name: "manage-automation", args: mutations[6].args },
  ])("passes the trusted MCP caller through $name", async ({ name, args }) => {
    await callable()[name as "manage-automations" | "manage-automation"].run(
      { ...args, caller: "frontend", mcpManaged: false } as any,
      { caller: "mcp", userEmail: owner, orgId: "org-1" },
    );
    const write =
      ("action" in args && args.action === "define") ||
      ("operation" in args && args.operation === "create")
        ? mocks.defineAutomation
        : mocks.updateAutomation;
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ caller: "mcp" }),
      expect.not.objectContaining({ mcpManaged: false }),
    );
  });
});
