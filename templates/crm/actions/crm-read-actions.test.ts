import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getCrmOverview: vi.fn(),
  getCrmRecord: vi.fn(),
  getCrmRecordReadContext: vi.fn(),
  getReadThroughRelationshipSummaries: vi.fn(),
  listCrmProposals: vi.fn(),
  listCrmRecords: vi.fn(),
  listCrmSavedViews: vi.fn(),
  listCrmSignals: vi.fn(),
  listCrmTasks: vi.fn(),
  persistReadThroughRelationships: vi.fn(),
}));
const adapters = vi.hoisted(() => ({ createAdapter: vi.fn() }));
const nativeAdapters = vi.hoisted(() => ({
  createAdapter: vi.fn(),
  resolveScope: vi.fn(),
}));
const applicationState = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("../server/db/crm-store.js", () => store);
vi.mock("../server/crm/adapter.js", () => ({
  createConnectedCrmAdapter: adapters.createAdapter,
  isConnectedCrmProvider: (provider: string) =>
    provider === "hubspot" || provider === "salesforce",
}));
vi.mock("../server/crm/native-adapter.js", () => ({
  createNativeCrmAdapter: nativeAdapters.createAdapter,
  resolveNativeCrmAccessScope: nativeAdapters.resolveScope,
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
    store.listCrmSignals.mockReset();
    store.listCrmSignals.mockResolvedValue([]);
    store.listCrmTasks.mockReset();
    store.persistReadThroughRelationships.mockReset();
    adapters.createAdapter.mockReset();
    nativeAdapters.createAdapter.mockReset();
    nativeAdapters.resolveScope.mockReset();
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

  it("validates Native SQL list rows through the native ownership scope", async () => {
    const scope = { key: "native:crm-connection", mode: "native" };
    store.listCrmRecords.mockImplementation(async (_input, options) => ({
      scope: await options.resolveScope({
        connectionId: "crm-connection",
        workspaceConnectionId: null,
        provider: "native",
        objectType: "accounts",
      }),
    }));
    nativeAdapters.resolveScope.mockResolvedValue(scope);

    await expect(
      listCrmRecords.run({ kind: "account", limit: 50 }),
    ).resolves.toEqual({ scope });
    expect(nativeAdapters.resolveScope).toHaveBeenCalledWith({
      connectionId: "crm-connection",
      objectType: "accounts",
    });
    expect(adapters.createAdapter).not.toHaveBeenCalled();
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
    adapters.createAdapter.mockResolvedValue({
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

  it("reads Native SQL records with the local access scope and no provider connection", async () => {
    const scope = {
      key: "native:crm-connection",
      actorId: "owner@example.test",
      mode: "native",
      objectReadable: true,
      objectCreateable: true,
      objectUpdateable: true,
      objectDeleteable: true,
      recordVisibility: "workspace",
    } as const;
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-native",
      connectionId: "crm-connection",
      workspaceConnectionId: null,
      provider: "native",
      objectType: "accounts",
      kind: "account",
      remoteId: "native-account-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [
        {
          fieldName: "name",
          storagePolicy: "local-authoritative",
          readable: true,
          sensitive: false,
        },
      ],
    });
    nativeAdapters.createAdapter.mockResolvedValue({
      connection: { connectionId: "crm-connection", provider: "native" },
      getAccessScope: () => scope,
      getRecord: vi.fn().mockResolvedValue({
        ref: {
          connectionId: "crm-connection",
          provider: "native",
          objectType: "accounts",
          kind: "account",
          remoteId: "native-account-1",
          localId: "record-native",
        },
        displayName: "Native account",
        fields: {},
        remoteRevision: "1",
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
    store.getCrmRecord.mockResolvedValue({ id: "record-native" });

    await expect(
      getCrmRecord.run({ recordId: "record-native" }),
    ).resolves.toEqual({ id: "record-native" });
    expect(nativeAdapters.createAdapter).toHaveBeenCalledWith({
      connectionId: "crm-connection",
      accessTier: "viewer",
    });
    expect(adapters.createAdapter).not.toHaveBeenCalled();
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
    adapters.createAdapter.mockResolvedValue({
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

    expect(adapters.createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "hubspot",
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
