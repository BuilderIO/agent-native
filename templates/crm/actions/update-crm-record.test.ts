import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  inserted: [] as unknown[],
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

import { decideCrmWritePolicy } from "../shared/crm-contract.js";
import action, { fieldPatchSchema } from "./update-crm-record.js";

const record = {
  id: "record-1",
  tombstone: false,
  connectionId: "connection-1",
  objectType: "deals",
  remoteId: "deal-1",
  remoteRevision: "revision-1",
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
  });

  it("keeps automation writes denied by the shared policy matrix", () => {
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
    ).toBe("deny");
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

  it("queues provider fields as a proposal and replays an identical idempotency key", async () => {
    const existing = {
      id: "mutation-1",
      recordId: record.id,
      target: "provider",
      patchJson: JSON.stringify({ fields: { customField: "value" } }),
      expectedRemoteRevision: null,
      status: "pending",
      policyDecision: "propose",
    };
    state.selectRows = [[record], [policy("mirrored")], [existing]];

    const result = await action.run(
      {
        recordId: record.id,
        target: "provider",
        fields: { customField: "value" },
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
});
