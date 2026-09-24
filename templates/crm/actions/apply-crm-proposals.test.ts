import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updates: [] as unknown[],
  updateResults: [] as unknown[],
  link: { available: true, url: "https://app.hubspot.com/record" } as unknown,
}));

/**
 * `.limit()` is optional in the action: the record-field read is an unbounded
 * `where(...)` await, every other read chains `.limit(1)`.
 */
function query(rows: unknown[]) {
  return Object.assign(rows, { limit: vi.fn().mockResolvedValue(rows) });
}

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ scoped: true })),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/crm/adapter.js", () => ({
  isConnectedCrmProvider: (provider: string) =>
    provider === "hubspot" || provider === "salesforce",
}));

vi.mock("../server/crm/provider-record-link.js", () => ({
  resolveProviderRecordLink: vi.fn(async () => state.link),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => query(state.selectRows.shift() ?? []),
      }),
    }),
    update: () => ({
      set: (value: unknown) => {
        state.updates.push(value);
        return {
          where: vi
            .fn()
            .mockImplementation(
              async () => state.updateResults.shift() ?? { rowsAffected: 1 },
            ),
        };
      },
    }),
  }),
  schema: {
    crmMutations: {
      id: "mutations.id",
      status: "mutations.status",
      recordId: "mutations.recordId",
      connectionId: "mutations.connectionId",
    },
    crmMutationShares: {},
    crmRecords: { id: "records.id", tombstone: "records.tombstone" },
    crmRecordShares: {},
    crmRecordFields: {
      recordId: "fields.recordId",
      entryId: "fields.entryId",
      activeUntil: "fields.activeUntil",
      fieldName: "fields.fieldName",
      stringValue: "fields.stringValue",
      numberValue: "fields.numberValue",
      booleanValue: "fields.booleanValue",
      jsonValue: "fields.jsonValue",
    },
    crmRecordFieldShares: {},
    crmConnections: { id: "connections.id" },
    crmConnectionShares: {},
  },
}));

import action from "./apply-crm-proposals.js";

const record = {
  id: "record-1",
  tombstone: false,
  displayName: "Northwind renewal",
  objectType: "deals",
  kind: "opportunity",
  remoteId: "deal-1",
  remoteRevision: "revision-1",
  ownerEmail: "owner@example.test",
  orgId: "org-1",
  visibility: "org",
};
const connection = {
  id: "connection-1",
  provider: "hubspot",
  accountId: "1234567",
  workspaceConnectionId: "workspace-1",
};

function mirroredField(
  fieldName: string,
  values: Partial<{
    stringValue: string;
    numberValue: number;
    booleanValue: boolean;
    jsonValue: string;
  }>,
) {
  return {
    fieldName,
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue: null,
    ...values,
  };
}

function proposal(
  fields: Record<string, unknown>,
  expectedRemoteRevision: string | null = "revision-1",
) {
  return {
    id: "proposal-1",
    recordId: record.id,
    connectionId: connection.id,
    target: "provider",
    operation: "update",
    status: "pending",
    patchJson: JSON.stringify({ fields }),
    expectedRemoteRevision,
    idempotencyKey: "proposal-key",
  };
}

describe("apply-crm-proposals", () => {
  beforeEach(() => {
    state.selectRows = [];
    state.updates = [];
    state.updateResults = [];
    state.link = {
      available: true,
      url: "https://app.hubspot.com/contacts/1234567/record/0-3/deal-1",
    };
  });

  it("requires an explicit approval before preparing the handoff", () => {
    expect(action.needsApproval).toBe(true);
  });

  it("prepares a HubSpot handoff with a diff and deep link and never errors", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [mirroredField("dealname", { stringValue: "Northwind renewal" })],
    ];
    state.updateResults = [{ count: 1 }];

    const result = await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({
      status: "approved",
      upstreamApplied: false,
      provider: "hubspot",
      providerLabel: "HubSpot",
      recordUrl: "https://app.hubspot.com/contacts/1234567/record/0-3/deal-1",
      recordUrlUnavailableReason: null,
      fields: [
        {
          name: "dealname",
          beforeKnown: true,
          before: "Northwind renewal",
          after: "Renewal",
        },
      ],
    });
    expect(result.guidance).not.toMatch(/failed|error/i);
  });

  it("records the ledger entry as approved-but-never-applied", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [],
    ];
    state.updateResults = [{ rowsAffected: 1 }];

    await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(state.updates).toEqual([
      {
        status: "approved",
        approvedBy: record.ownerEmail,
        approvedAt: expect.any(String),
        error: null,
        updatedAt: expect.any(String),
      },
    ]);
    // Distinguishable from applied (`appliedAt`/`status: "applied"`) and from
    // failed (`status: "failed"`/`"rejected"` with a non-null `error`).
    const [ledger] = state.updates as Array<Record<string, unknown>>;
    expect(ledger).not.toHaveProperty("appliedAt");
    expect(ledger.error).toBeNull();
    expect(ledger.status).not.toBe("applied");
  });

  it("marks a field the mirror does not hold as unknown rather than empty", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [],
    ];
    state.updateResults = [{ rowsAffected: 1 }];

    const result = await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result.fields).toEqual([
      {
        name: "dealname",
        beforeKnown: false,
        before: null,
        after: "Renewal",
      },
    ]);
  });

  it("prepares Salesforce proposals through the same honest path", async () => {
    state.link = {
      available: true,
      url: "https://builder.my.salesforce.com/lightning/r/Opportunity/0065g00000ABCdEAAV/view",
    };
    state.selectRows = [
      [proposal({ StageName: "Closed Won" })],
      [
        {
          ...record,
          objectType: "Opportunity",
          remoteId: "0065g00000ABCdEAAV",
        },
      ],
      [{ ...connection, provider: "salesforce", accountId: "00Dexample" }],
      [mirroredField("StageName", { stringValue: "Negotiation" })],
    ];
    state.updateResults = [{ rowsAffected: 1 }];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({
      status: "approved",
      upstreamApplied: false,
      providerLabel: "Salesforce",
      recordUrl:
        "https://builder.my.salesforce.com/lightning/r/Opportunity/0065g00000ABCdEAAV/view",
    });
  });

  it("still prepares the handoff when no deep link can be built", async () => {
    state.link = { available: false, reason: "missing-portal-id" };
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [{ ...connection, accountId: null }],
      [],
    ];
    state.updateResults = [{ rowsAffected: 1 }];

    const result = await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({
      status: "approved",
      recordUrl: null,
      recordUrlUnavailableReason: "missing-portal-id",
    });
    expect(result.guidance).toContain("missing-portal-id");
  });

  it("lets only one concurrent preparation transition the pending proposal", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [],
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [],
    ];
    state.updateResults = [{ rowsAffected: 1 }, { rowsAffected: 0 }];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({ status: "approved" });
    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).rejects.toThrow("already claimed");
  });

  it("rejects an unsafe proposal patch before recording the handoff", async () => {
    state.selectRows = [
      [proposal({ transcript: "not permitted" })],
      [record],
      [connection],
    ];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).rejects.toThrow("unsafe field patch");
    expect(state.updates).toEqual([]);
  });

  it("fails closed when a legacy proposal has no expected remote revision", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" }, null)],
      [record],
      [connection],
    ];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).rejects.toThrow("no remote revision");
    expect(state.updates).toEqual([]);
  });
});
