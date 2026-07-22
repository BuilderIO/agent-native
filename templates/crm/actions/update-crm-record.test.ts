import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  inserted: [] as unknown[],
  nativeMutations: [] as unknown[],
  nativeResult: {
    status: "applied" as "applied" | "conflict" | "rejected",
    remoteRevision: "revision-2",
    message: undefined as string | undefined,
  },
}));

function query(rows: unknown[]) {
  return Object.assign(rows, { limit: vi.fn().mockResolvedValue(rows) });
}

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ scoped: true })),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/db/index.js", () => {
  const select = () => ({
    from: () => ({
      where: () => query(state.selectRows.shift() ?? []),
    }),
  });
  const insert = () => ({
    values: vi.fn(async (value) => state.inserted.push(value)),
  });
  return {
    getDb: () => ({
      select,
      insert,
      transaction: async (
        run: (tx: {
          select: typeof select;
          insert: typeof insert;
        }) => Promise<void>,
      ) => run({ select, insert }),
    }),
    schema: {
      crmRecords: {
        id: "records.id",
        tombstone: "records.tombstone",
        connectionId: "records.connectionId",
        objectType: "records.objectType",
        remoteRevision: "records.remoteRevision",
        desiredCadenceDays: "records.desiredCadenceDays",
      },
      crmRecordShares: {},
      crmFieldPolicies: {
        connectionId: "policies.connectionId",
        objectType: "policies.objectType",
        fieldName: "policies.fieldName",
      },
      crmFieldPolicyShares: {},
      crmMutations: { idempotencyKey: "mutations.idempotencyKey" },
      crmMutationShares: {},
      crmRecordFields: {
        id: "fields.id",
        recordId: "fields.recordId",
        fieldName: "fields.fieldName",
      },
      crmRecordFieldShares: {},
    },
  };
});

vi.mock("../server/crm/native-adapter.js", () => ({
  createNativeCrmAdapter: vi.fn(async () => ({
    applyMutation: vi.fn(async (mutation) => {
      state.nativeMutations.push(mutation);
      return state.nativeResult;
    }),
  })),
}));

import { decideCrmWritePolicy } from "../shared/crm-contract.js";
import { CRM_SALES_ROUTINE_LOCAL_POLICY_ID } from "../shared/crm-sales-config.js";
import action, { fieldPatchSchema } from "./update-crm-record.js";

const record = {
  id: "record-1",
  tombstone: false,
  connectionId: "connection-1",
  objectType: "deals",
  remoteId: "deal-1",
  remoteRevision: "revision-1",
  provider: "hubspot",
  kind: "opportunity",
  accessScopeKey: "scope-1",
  accessScopeJson: "{}",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  visibility: "org",
};

function policy(storagePolicy: "mirrored" | "local-authoritative") {
  return {
    id: `policy-${storagePolicy}`,
    fieldName: "customField",
    valueType: "string",
    storagePolicy,
    updateable: true,
  };
}

describe("update-crm-record", () => {
  beforeEach(() => {
    state.selectRows = [];
    state.inserted = [];
    state.nativeMutations = [];
    state.nativeResult = {
      status: "applied",
      remoteRevision: "revision-2",
      message: undefined,
    };
  });

  it("keeps provider automation writes proposal-first in the shared policy matrix", () => {
    expect(
      decideCrmWritePolicy({
        initiatedBy: "automation",
        target: "provider",
        reversibility: "compensatable",
        scope: "single-field",
        risk: "routine",
        delegatedAuthority: false,
        storedAutomationPolicy: false,
      }),
    ).toBe("propose");
  });

  it("executes only a stored routine local automation policy", () => {
    expect(
      decideCrmWritePolicy({
        initiatedBy: "automation",
        target: "local",
        reversibility: "compensatable",
        scope: "single-record",
        risk: "routine",
        delegatedAuthority: true,
        storedAutomationPolicy: true,
      }),
    ).toBe("execute");
    expect(
      decideCrmWritePolicy({
        initiatedBy: "automation",
        target: "local",
        reversibility: "compensatable",
        scope: "single-record",
        risk: "stage",
        delegatedAuthority: true,
        storedAutomationPolicy: true,
      }),
    ).toBe("require-approval");
  });

  it("applies an allowed local-authoritative field and records a local mutation", async () => {
    state.selectRows = [[record], [policy("local-authoritative")], [], []];

    const result = await action.run(
      {
        recordId: record.id,
        target: "local",
        fields: { customField: "value" },
      },
      { caller: "frontend", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({ recordId: record.id, status: "applied" });
    expect(state.inserted).toHaveLength(2);
  });

  it("executes a routine local automation update only with the typed sales policy", async () => {
    state.selectRows = [[record], [policy("local-authoritative")], [], []];

    await expect(
      action.run(
        {
          recordId: record.id,
          target: "local",
          fields: { customField: "value" },
        },
        {
          caller: "automation",
          userEmail: record.ownerEmail,
          orgId: record.orgId,
          automation: {
            triggerId: "trigger-1",
            triggerName: "crm-follow-up",
            policyId: CRM_SALES_ROUTINE_LOCAL_POLICY_ID,
          },
        },
      ),
    ).resolves.toMatchObject({ status: "applied" });
    expect(state.inserted).toHaveLength(2);
  });

  it("rejects a routine local automation update without its stored policy", async () => {
    state.selectRows = [[record], [policy("local-authoritative")]];

    await expect(
      action.run(
        {
          recordId: record.id,
          target: "local",
          fields: { customField: "value" },
        },
        {
          caller: "automation",
          userEmail: record.ownerEmail,
          orgId: record.orgId,
          automation: { triggerId: "trigger-1", triggerName: "crm-follow-up" },
        },
      ),
    ).rejects.toThrow("not authorized");
    expect(state.inserted).toEqual([]);
  });

  it("applies a revision-checked Native SQL update through the native adapter", async () => {
    const nativeRecord = {
      ...record,
      provider: "native",
      objectType: "opportunities",
      remoteId: "native-opportunity-1",
    };
    const appliedMutation = {
      id: "native-mutation-1",
      recordId: nativeRecord.id,
      target: "local",
      patchJson: JSON.stringify({ fields: { customField: "value" } }),
      expectedRemoteRevision: "revision-1",
      status: "applied",
      policyDecision: "execute",
    };
    state.selectRows = [
      [nativeRecord],
      [policy("local-authoritative")],
      [],
      [appliedMutation],
    ];

    const result = await action.run(
      {
        recordId: nativeRecord.id,
        target: "local",
        fields: { customField: "value" },
        expectedRemoteRevision: "revision-1",
        idempotencyKey: "native-update",
      },
      { caller: "frontend", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({
      mutationId: "native-mutation-1",
      status: "applied",
      revision: "revision-2",
    });
    expect(state.nativeMutations).toHaveLength(1);
    expect(state.nativeMutations[0]).toMatchObject({
      operation: "update",
      expectedRemoteRevision: "revision-1",
      record: { provider: "native", localId: nativeRecord.id },
    });
    expect(state.inserted).toEqual([]);
  });

  it("requires a revision for Native SQL updates", async () => {
    state.selectRows = [
      [{ ...record, provider: "native", objectType: "opportunities" }],
      [policy("local-authoritative")],
      [],
    ];

    await expect(
      action.run(
        {
          recordId: record.id,
          target: "local",
          fields: { customField: "value" },
        },
        {
          caller: "frontend",
          userEmail: record.ownerEmail,
          orgId: record.orgId,
        },
      ),
    ).rejects.toThrow("require the current record revision");
    expect(state.nativeMutations).toEqual([]);
  });

  it("queues provider fields as a proposal and replays an identical idempotency key", async () => {
    const existing = {
      id: "mutation-1",
      recordId: record.id,
      target: "provider",
      patchJson: JSON.stringify({ fields: { customField: "value" } }),
      expectedRemoteRevision: "revision-1",
      status: "pending",
      policyDecision: "propose",
    };
    state.selectRows = [[record], [policy("mirrored")], [existing]];

    const result = await action.run(
      {
        recordId: record.id,
        target: "provider",
        fields: { customField: "value" },
        expectedRemoteRevision: record.remoteRevision,
        idempotencyKey: "same-request",
      },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({
      mutationId: "mutation-1",
      status: "pending",
      replayed: true,
    });
    expect(state.inserted).toEqual([]);
  });

  it("rejects transcript and binary-shaped patches before a database read", () => {
    expect(
      fieldPatchSchema.safeParse({ transcript: "not permitted" }).success,
    ).toBe(false);
    expect(
      fieldPatchSchema.safeParse({ note: "data:text/plain;base64,AAAA" })
        .success,
    ).toBe(false);
  });

  it("derives the provider revision from the mirrored record", async () => {
    state.selectRows = [[record], [policy("mirrored")], []];

    await expect(
      action.run(
        {
          recordId: record.id,
          target: "provider",
          fields: { customField: "value" },
        },
        {
          caller: "tool",
          userEmail: record.ownerEmail,
          orgId: record.orgId,
        },
      ),
    ).resolves.toMatchObject({ status: "pending" });

    expect(state.inserted).toEqual([
      expect.objectContaining({ expectedRemoteRevision: "revision-1" }),
    ]);
  });

  it("fails closed when the mirrored record has no provider revision", async () => {
    state.selectRows = [
      [{ ...record, remoteRevision: null }],
      [policy("mirrored")],
    ];

    await expect(
      action.run(
        {
          recordId: record.id,
          target: "provider",
          fields: { customField: "value" },
        },
        {
          caller: "tool",
          userEmail: record.ownerEmail,
          orgId: record.orgId,
        },
      ),
    ).rejects.toThrow("require a current remote revision");
    expect(state.inserted).toEqual([]);
  });
});
