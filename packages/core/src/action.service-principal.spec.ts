import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("./db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("./db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(async () => {}),
}));
const recordActionAuditMock = vi.fn(async (_input: any) => {});
vi.mock("./audit/record.js", () => ({
  recordActionAudit: (input: any) => recordActionAuditMock(input),
}));

const { defineAction } = await import("./action.js");
const { executeAgentToolCall } = await import("./agent/production-agent.js");

const SVC = "svc-ci@service.org_1";
const runs: string[] = [];

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    org_id: "org_1",
    service_name: "ci",
    risk_tier: "medium",
    lifecycle: "active",
    allowed_actions: JSON.stringify(["list-things"]),
    ...overrides,
  };
}

function storeReturns(row: Record<string, unknown> | null) {
  executeMock.mockResolvedValue({ rows: row ? [row] : [], rowsAffected: 0 });
}

function thing(name: string) {
  return defineAction({
    description: name,
    run: async () => {
      runs.push(name);
      return { ok: name };
    },
  });
}

const listThings = thing("list-things");
const deleteThing = thing("delete-thing");

function ctxFor(actionName: string, userEmail: string | undefined = SVC) {
  return { userEmail, orgId: "org_1", caller: "mcp" as const, actionName };
}

async function refusal(promise: Promise<unknown>) {
  const error: any = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeDefined();
  return error;
}

function policyReads() {
  return executeMock.mock.calls.filter(([q]) =>
    String(q?.sql).includes("service_principal_policies"),
  );
}

function denials() {
  return recordActionAuditMock.mock.calls.filter(([input]) =>
    String(input.error?.errorCode).startsWith("service_principal_"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [], rowsAffected: 0 });
  runs.length = 0;
});

describe("defineAction service-principal grant", () => {
  it("runs a granted action", async () => {
    storeReturns(policyRow());
    await expect(listThings.run({}, ctxFor("list-things"))).resolves.toEqual({
      ok: "list-things",
    });
    expect(runs).toEqual(["list-things"]);
    expect(denials()).toEqual([]);
  });

  it("refuses an action outside the grant with exactly one denied row", async () => {
    storeReturns(policyRow());
    const error = await refusal(deleteThing.run({}, ctxFor("delete-thing")));
    expect(error).toMatchObject({
      errorCode: "service_principal_action_denied",
      statusCode: 403,
    });
    expect(error.message).toBe(
      "Forbidden: delete-thing is not permitted for this service principal.",
    );
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
    expect(recordActionAuditMock.mock.calls[0][0].ctx).toMatchObject({
      actionName: "delete-thing",
      caller: "mcp",
      userEmail: SVC,
    });
  });

  it("denies a call that carries no action name unless the grant is a bare wildcard", async () => {
    storeReturns(policyRow());
    await refusal(
      deleteThing.run({}, { ...ctxFor("x"), actionName: undefined }),
    );
    expect(runs).toEqual([]);
    storeReturns(policyRow({ allowed_actions: JSON.stringify(["*"]) }));
    await deleteThing.run({}, { ...ctxFor("x"), actionName: undefined });
    expect(runs).toEqual(["delete-thing"]);
  });

  it("does not restrict an ungoverned principal", async () => {
    storeReturns(null);
    await deleteThing.run({}, ctxFor("delete-thing"));
    expect(runs).toEqual(["delete-thing"]);
    expect(denials()).toEqual([]);
  });

  it("stops a principal suspended mid-run on its next action call", async () => {
    storeReturns(policyRow({ allowed_actions: null }));
    await listThings.run({}, ctxFor("list-things"));
    storeReturns(policyRow({ allowed_actions: null, lifecycle: "suspended" }));
    const error = await refusal(listThings.run({}, ctxFor("list-things")));
    expect(error).toMatchObject({
      errorCode: "service_principal_inactive",
      statusCode: 403,
    });
    expect(runs).toEqual(["list-things"]);
    expect(denials()).toHaveLength(1);
  });

  it("answers 503 and writes no row when the policy cannot be read", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    const error = await refusal(listThings.run({}, ctxFor("list-things")));
    expect(error).toMatchObject({
      errorCode: "service_principal_unavailable",
      statusCode: 503,
    });
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });

  it("never queries the policy store for a non-service caller", async () => {
    await listThings.run({}, ctxFor("list-things", "alice@example.com"));
    await deleteThing.run(
      {},
      { ...ctxFor("delete-thing"), userEmail: undefined },
    );
    await deleteThing.run({});
    expect(runs).toEqual(["list-things", "delete-thing", "delete-thing"]);
    expect(policyReads()).toEqual([]);
  });
});

describe("delegated agent run as a service principal", () => {
  function entries() {
    return {
      "list-things": { ...listThings, tool: listThings.tool },
      "delete-thing": { ...deleteThing, tool: deleteThing.tool },
      // A framework tool that is not a defineAction: only the agent seam sees it.
      bash: {
        tool: { description: "bash", parameters: { type: "object" } },
        readOnly: true,
        run: async () => {
          runs.push("bash");
          return "ran";
        },
      },
    } as any;
  }

  const call = (name: string) =>
    executeAgentToolCall({
      actions: entries(),
      name,
      input: {},
      callId: `call-${name}`,
      ownerEmail: SVC,
      orgId: "org_1",
    });

  it("runs the granted action", async () => {
    storeReturns(policyRow());
    const result = await call("list-things");
    expect(result.status).toBe("completed");
    expect(runs).toEqual(["list-things"]);
  });

  it("refuses an ungranted action with one denied row", async () => {
    storeReturns(policyRow());
    const result = await call("delete-thing");
    expect(result.status).toBe("failed");
    expect(result.output).toContain("not permitted for this service principal");
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-defineAction framework tool outside the grant", async () => {
    storeReturns(policyRow());
    const result = await call("bash");
    expect(result.status).toBe("failed");
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
  });

  it("refuses the next call once the principal is suspended", async () => {
    storeReturns(policyRow());
    await call("list-things");
    storeReturns(policyRow({ lifecycle: "suspended" }));
    const result = await call("list-things");
    expect(result.status).toBe("failed");
    expect(result.output).toContain("suspended or retired");
    expect(runs).toEqual(["list-things"]);
  });

  it("returns a retryable error and no row when the policy is unreadable", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    const result = await call("list-things");
    expect(result.status).toBe("failed");
    expect(result.output).toContain("could not be verified");
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });

  it("never queries the policy store for a human-owned run", async () => {
    const result = await executeAgentToolCall({
      actions: entries(),
      name: "delete-thing",
      input: {},
      callId: "call-human",
      ownerEmail: "alice@example.com",
      orgId: "org_1",
    });
    expect(result.status).toBe("completed");
    expect(policyReads()).toEqual([]);
  });
});
