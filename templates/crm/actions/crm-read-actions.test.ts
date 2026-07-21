import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getCrmOverview: vi.fn(),
  getCrmRecord: vi.fn(),
  getCrmRecordReadContext: vi.fn(),
  getReadThroughRelationshipSummaries: vi.fn(),
  listCrmProposals: vi.fn(),
  listCrmRecords: vi.fn(),
  listCrmSavedViews: vi.fn(),
  listCrmTasks: vi.fn(),
  persistReadThroughRelationships: vi.fn(),
}));
const hubspot = vi.hoisted(() => ({ createAdapter: vi.fn() }));
const applicationState = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("../server/db/crm-store.js", () => store);
vi.mock("../server/crm/hubspot-adapter.js", () => ({
  createHubSpotCrmAdapter: hubspot.createAdapter,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: applicationState.read,
}));

import getCrmOverview from "./get-crm-overview.js";
import getCrmRecord from "./get-crm-record.js";
import listCrmProposals from "./list-crm-proposals.js";
import listCrmRecords from "./list-crm-records.js";
import listCrmSavedViews from "./list-crm-saved-views.js";
import listCrmTasks from "./list-crm-tasks.js";
import viewScreen from "./view-screen.js";

describe("CRM read actions", () => {
  beforeEach(() => {
    store.getCrmOverview.mockReset();
    store.getCrmRecord.mockReset();
    store.getCrmRecordReadContext.mockReset();
    store.getReadThroughRelationshipSummaries.mockReset();
    store.listCrmProposals.mockReset();
    store.listCrmRecords.mockReset();
    store.listCrmSavedViews.mockReset();
    store.listCrmTasks.mockReset();
    store.persistReadThroughRelationships.mockReset();
    hubspot.createAdapter.mockReset();
    applicationState.read.mockReset();
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
        remoteRevision: "live-revision",
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships,
    });
    store.getReadThroughRelationshipSummaries.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-1" });

    await expect(getCrmRecord.run({ recordId: "record-1" })).resolves.toEqual({
      id: "record-1",
    });
    expect(listRelationships).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
    expect(store.getCrmRecord).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({ remoteRevision: "live-revision" }),
    );
    expect(store.persistReadThroughRelationships).not.toHaveBeenCalled();
  });

  it("uses the same live provider proof for a visible record", async () => {
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
    applicationState.read.mockImplementation(async (key: string) => {
      if (key === "navigation") return { view: "record", recordId: "record-1" };
      return null;
    });
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-1",
      connectionId: "crm-connection",
      workspaceConnectionId: "hubspot-connection",
      provider: "hubspot",
      objectType: "companies",
      kind: "account",
      remoteId: "company-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [
        {
          fieldName: "name",
          storagePolicy: "mirrored",
          readable: true,
          sensitive: false,
        },
      ],
    });
    hubspot.createAdapter.mockResolvedValue({
      connection: { connectionId: "hubspot-connection", provider: "hubspot" },
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
        fields: { name: "Northstar" },
        remoteRevision: "live-revision",
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships: vi.fn().mockResolvedValue({
        relationships: [],
        complete: true,
      }),
    });
    store.getReadThroughRelationshipSummaries.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-1" });

    await expect(
      viewScreen.run({}, { userEmail: "owner@example.test" } as never),
    ).resolves.toMatchObject({ record: { id: "record-1" } });

    expect(hubspot.createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "hubspot-connection",
        userEmail: "owner@example.test",
      }),
    );
    expect(store.getCrmRecord).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({
        fields: { name: "Northstar" },
        remoteRevision: "live-revision",
      }),
    );
  });
});
