import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updates: [] as unknown[],
  updateResults: [] as unknown[],
  applyMutation: vi.fn(),
}));

function query(rows: unknown[]) {
  return Object.assign(rows, { limit: vi.fn().mockResolvedValue(rows) });
}

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ scoped: true })),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/crm/hubspot-adapter.js", () => ({
  createHubSpotCrmAdapter: vi.fn(async () => ({
    connection: { connectionId: "workspace-1", provider: "hubspot" },
    applyMutation: state.applyMutation,
  })),
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
    state.applyMutation.mockReset();
  });

  it("requires an explicit approval before provider execution", () => {
    expect(action.needsApproval).toBe(true);
  });

  it("marks an approved provider proposal applied", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.applyMutation.mockResolvedValue({
      status: "applied",
      remoteRevision: "r2",
    });

    const result = await action.run(
      { proposalId: "proposal-1" },
      { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
    );

    expect(result).toMatchObject({ status: "applied", remoteRevision: "r2" });
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "executing" }),
        expect.objectContaining({
          status: "applied",
          providerRemoteRevision: "r2",
        }),
      ]),
    );
  });

  it("persists provider conflicts and transient failures without leaking transport errors", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.applyMutation.mockResolvedValue({
      status: "conflict",
      remoteRevision: "r3",
    });

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({ status: "conflict", remoteRevision: "r3" });
    expect(state.updates.at(-1)).toMatchObject({ status: "conflict" });

    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.applyMutation.mockRejectedValue(new Error("provider response body"));
    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      message: "CRM provider mutation could not be completed.",
    });
    expect(state.updates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("rejects an unsafe proposal patch before calling the provider", async () => {
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
    expect(state.applyMutation).not.toHaveBeenCalled();
  });

  it("does not call HubSpot when another request already claimed the proposal", async () => {
    state.selectRows = [
      [proposal({ dealname: "Renewal" })],
      [record],
      [connection],
    ];
    state.updateResults = [{ rowsAffected: 0 }];

    await expect(
      action.run(
        { proposalId: "proposal-1" },
        { caller: "tool", userEmail: record.ownerEmail, orgId: record.orgId },
      ),
    ).rejects.toThrow("already claimed");
    expect(state.applyMutation).not.toHaveBeenCalled();
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
    expect(state.applyMutation).not.toHaveBeenCalled();
  });
});
