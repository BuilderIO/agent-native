import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getCrmOverview: vi.fn(),
  getCrmRecord: vi.fn(),
  getCrmRecordReadContext: vi.fn(),
  listCrmProposals: vi.fn(),
  listCrmRecords: vi.fn(),
  listCrmSavedViews: vi.fn(),
  listCrmTasks: vi.fn(),
  persistReadThroughRelationships: vi.fn(),
}));
const hubspot = vi.hoisted(() => ({ createAdapter: vi.fn() }));

vi.mock("../server/db/crm-store.js", () => store);
vi.mock("../server/crm/hubspot-adapter.js", () => ({
  createHubSpotCrmAdapter: hubspot.createAdapter,
}));

import getCrmOverview from "./get-crm-overview.js";
import getCrmRecord from "./get-crm-record.js";
import listCrmProposals from "./list-crm-proposals.js";
import listCrmRecords from "./list-crm-records.js";
import listCrmSavedViews from "./list-crm-saved-views.js";
import listCrmTasks from "./list-crm-tasks.js";

describe("CRM read actions", () => {
  beforeEach(() => {
    store.getCrmOverview.mockReset();
    store.getCrmRecord.mockReset();
    store.getCrmRecordReadContext.mockReset();
    store.listCrmProposals.mockReset();
    store.listCrmRecords.mockReset();
    store.listCrmSavedViews.mockReset();
    store.listCrmTasks.mockReset();
    store.persistReadThroughRelationships.mockReset();
    hubspot.createAdapter.mockReset();
  });

  it("keeps every read action GET-only", () => {
    for (const action of [
      getCrmOverview,
      getCrmRecord,
      listCrmProposals,
      listCrmRecords,
      listCrmSavedViews,
      listCrmTasks,
    ]) {
      expect(action.http).toMatchObject({ method: "GET" });
      expect(action.readOnly).toBe(true);
    }
  });

  it("bounds list inputs before reading the store", async () => {
    store.listCrmRecords.mockResolvedValue({ records: [] });
    const input = listCrmRecords.schema.parse({ kind: "account" });

    await listCrmRecords.run(input);

    expect(store.listCrmRecords).toHaveBeenCalledWith(
      { kind: "account", limit: 50 },
      expect.objectContaining({ resolveScope: expect.any(Function) }),
    );
    expect(
      listCrmRecords.schema.safeParse({ kind: "account", limit: 101 }).success,
    ).toBe(false);
  });

  it("does not reveal a missing record as a successful empty result", async () => {
    store.getCrmRecordReadContext.mockResolvedValue(null);

    await expect(
      getCrmRecord.run({ recordId: "missing" }),
    ).rejects.toMatchObject({
      message: "CRM record not found",
      statusCode: 404,
    });
  });

  it("bounds provider relationship calls during a read-through refresh", async () => {
    const scope = {
      key: "hubspot:grant",
      actorId: "owner@example.test",
      grantId: "grant",
      mode: "user",
      objectReadable: true,
      objectCreateable: false,
      objectUpdateable: false,
      objectDeleteable: false,
      recordVisibility: "actor",
    } as const;
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-1",
      connectionId: "crm-connection",
      workspaceConnectionId: "hubspot-connection",
      provider: "hubspot",
      objectType: "companies",
      kind: "account",
      remoteId: "company-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [],
    });
    const listRelationships = vi.fn().mockResolvedValue({
      relationships: [],
      complete: true,
    });
    hubspot.createAdapter.mockResolvedValue({
      connection: { connectionId: "hubspot-connection" },
      getAccessScope: () => scope,
      getRecord: vi.fn().mockResolvedValue({
        ref: {
          connectionId: "hubspot-connection",
          provider: "hubspot",
          objectType: "companies",
          kind: "account",
          remoteId: "company-1",
        },
        displayName: "Northstar",
        fields: {},
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships,
    });
    store.persistReadThroughRelationships.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-1" });

    await expect(getCrmRecord.run({ recordId: "record-1" })).resolves.toEqual({
      id: "record-1",
    });
    expect(listRelationships).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });
});
