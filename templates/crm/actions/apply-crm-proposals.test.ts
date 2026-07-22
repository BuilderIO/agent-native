import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updates: [] as unknown[],
  updateResults: [] as unknown[],
}));

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
    crmConnections: { id: "connections.id" },
    crmConnectionShares: {},
  },
}));

import action from "./apply-crm-proposals.js";

const record = {
  id: "record-1",
  tombstone: false,
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
  workspaceConnectionId: "workspace-1",
};

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
  });

  it("requires an explicit approval before provider execution", () => {
    expect(action.needsApproval).toBe(true);
  });

  it("records approval and rejects a proposal when HubSpot lacks conditional mutations", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.updateResults = [{ count: 1 }];

    const result = await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({
      status: "rejected",
      message: expect.stringContaining("atomic expected-revision write path"),
    });
    expect(state.updates).toEqual([
      expect.objectContaining({
        status: "rejected",
        approvedBy: record.ownerEmail,
        approvedAt: expect.any(String),
        error: expect.stringContaining("atomic expected-revision write path"),
      }),
    ]);
  });

  it("reviews Salesforce proposals with the same fail-closed boundary", async () => {
    state.selectRows = [
      [proposal({ StageName: "Closed Won" })],
      [{ ...record, objectType: "Opportunity", remoteId: "opportunity-1" }],
      [{ ...connection, provider: "salesforce" }],
    ];
    state.updateResults = [{ rowsAffected: 1 }];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      message: expect.stringContaining("Salesforce did not apply"),
    });
  });

  it("lets only one concurrent approval transition the pending proposal", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.updateResults = [{ rowsAffected: 1 }, { rowsAffected: 0 }];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({ status: "rejected" });
    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).rejects.toThrow("already claimed");
  });

  it("rejects an unsafe proposal patch before recording approval", async () => {
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
